// Replace your entire reports.js file with this
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const ExcelJS = require('exceljs');

// Helper function to convert UUID to binary
function uuidToBin(uuid) {
    if (!uuid) return null;
    const hex = uuid.replace(/-/g, '');
    return Buffer.from(hex, 'hex');
}

// Helper function to convert binary UUID to string
function binToUuid(bin) {
    if (!bin) return null;
    const hex = bin.toString('hex');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

// Middleware to get shop details
const getShopDetails = async (req, res, next) => {
    if (!req.session.shopId) {
        return res.status(403).json({ success: false, message: 'Shop not identified' });
    }

    try {
        const [shops] = await pool.execute(
            'SELECT * FROM shops WHERE id = UUID_TO_BIN(?)',
            [req.session.shopId]
        );

        req.shop = {
            id: req.session.shopId,
            name: shops[0]?.name || 'My Shop',
            logo: shops[0]?.logo ? `/uploads/${shops[0].logo}` : '/images/default-logo.png',
            currency: shops[0]?.currency || 'PKR',
            primary_color: shops[0]?.primary_color || '#007bff',
            secondary_color: shops[0]?.secondary_color || '#6c757d'
        };

        next();
    } catch (err) {
        console.error('Error fetching shop details:', err);
        req.shop = {
            id: req.session.shopId,
            name: 'My Shop',
            logo: '/images/default-logo.png',
            currency: 'PKR',
            primary_color: '#007bff',
            secondary_color: '#6c757d'
        };
        next();
    }
};

// GET /reports - Daily reports page
router.get('/', getShopDetails, async (req, res) => {
    try {
        res.render('reports/daily', {
            title: 'Daily Reports',
            shop: req.shop
        });
    } catch (err) {
        console.error('Error loading daily reports:', err);
        res.status(500).render('error', {
            message: 'Failed to load daily reports'
        });
    }
});

// API: GET /api/reports - Get daily reports data - FIXED for your schema
router.get('/api/reports', getShopDetails, async (req, res) => {
    try {
        const {
            startDate,
            endDate,
            paymentMethod,
            salesRange,
            timePeriod = 'daily',
            page = 1,
            limit = 10
        } = req.query;

        const offset = (page - 1) * limit;
        const shopIdBinary = uuidToBin(req.session.shopId);

        // Set default dates if not provided
        const defaultEndDate = new Date();
        const defaultStartDate = new Date();
        defaultStartDate.setDate(defaultEndDate.getDate() - 30);

        const finalStartDate = startDate || defaultStartDate.toISOString().split('T')[0];
        const finalEndDate = endDate || defaultEndDate.toISOString().split('T')[0];

        console.log('📅 Date range:', finalStartDate, 'to', finalEndDate);
        console.log('🏪 Shop ID:', req.session.shopId);

        // Build where conditions for the bills table
        let whereConditions = ['b.shop_id = UUID_TO_BIN(?)'];
        let queryParams = [req.session.shopId];

        // Date filter
        whereConditions.push('DATE(b.created_at) BETWEEN ? AND ?');
        queryParams.push(finalStartDate, finalEndDate);

        // Payment method filter
        if (paymentMethod && paymentMethod !== 'all') {
            whereConditions.push('b.payment_method = ?');
            queryParams.push(paymentMethod);
        }

        // Sales range filter
        if (salesRange && salesRange !== 'all') {
            switch (salesRange) {
                case 'low':
                    whereConditions.push('b.total_amount < 1000');
                    break;
                case 'medium':
                    whereConditions.push('b.total_amount BETWEEN 1000 AND 5000');
                    break;
                case 'high':
                    whereConditions.push('b.total_amount > 5000');
                    break;
            }
        }

        const whereClause = whereConditions.join(' AND ');
        console.log('🔍 Where clause:', whereClause);

        // Get total count
        const [countResult] = await pool.execute(`
            SELECT COUNT(*) as total 
            FROM bills b
            WHERE ${whereClause}
        `, queryParams);
        
        const total = countResult[0]?.total || 0;
        console.log('📊 Total bills found:', total);

        // Get paginated reports with item counts
        const [reports] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(b.id) as id,
                b.bill_number,
                b.customer_name,
                b.customer_phone,
                b.subtotal,
                b.discount,
                b.tax,
                b.total_amount,
                b.paid_amount,
                b.due_amount,
                b.payment_method,
                b.notes,
                DATE(b.created_at) as bill_date,
                b.created_at,
                u.name as created_by,
                COALESCE((
                    SELECT COUNT(*) 
                    FROM bill_items bi 
                    WHERE bi.bill_id = b.id
                ), 0) as items_count
            FROM bills b
            LEFT JOIN users u ON b.created_by = u.id
            WHERE ${whereClause}
            ORDER BY b.created_at DESC
            LIMIT ? OFFSET ?
        `, [...queryParams, parseInt(limit), parseInt(offset)]);

        console.log('📋 Reports found:', reports.length);

        // Get stats
        const [statsResult] = await pool.execute(`
            SELECT 
                COALESCE(SUM(b.total_amount), 0) as totalRevenue,
                COUNT(*) as totalSales,
                COUNT(DISTINCT b.customer_phone) as totalCustomers,
                COALESCE(AVG(b.total_amount), 0) as avgTransaction
            FROM bills b
            WHERE ${whereClause.replace(/b\./g, '')}
        `, queryParams.map(p => p === req.session.shopId ? req.session.shopId : p));

        const stats = {
            totalRevenue: parseFloat(statsResult[0]?.totalRevenue) || 0,
            totalSales: parseInt(statsResult[0]?.totalSales) || 0,
            totalCustomers: parseInt(statsResult[0]?.totalCustomers) || 0,
            avgTransaction: parseFloat(statsResult[0]?.avgTransaction) || 0,
            revenueTrend: 0,
            salesTrend: 0,
            customersTrend: 0,
            transactionTrend: 0
        };

        console.log('📈 Stats:', stats);

        // Get sales trend data
        const salesTrend = await getSalesTrend(req.session.shopId, finalStartDate, finalEndDate, timePeriod);
        
        // Get payment methods data
        const paymentMethods = await getPaymentMethods(req.session.shopId, finalStartDate, finalEndDate);

        res.json({
            success: true,
            reports: reports,
            totalPages: Math.ceil(total / limit),
            stats: stats,
            charts: {
                salesTrend,
                paymentMethods
            }
        });

    } catch (err) {
        console.error('Error fetching daily reports:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load reports: ' + err.message,
            error: err.toString()
        });
    }
});

// Helper function to get sales trend
async function getSalesTrend(shopId, startDate, endDate, timePeriod) {
    try {
        let groupBy, dateFormat;

        switch (timePeriod) {
            case 'weekly':
                groupBy = 'YEARWEEK(created_at)';
                dateFormat = '%Y Week %v';
                break;
            case 'monthly':
                groupBy = 'DATE_FORMAT(created_at, "%Y-%m")';
                dateFormat = '%M %Y';
                break;
            default: // daily
                groupBy = 'DATE(created_at)';
                dateFormat = '%b %d, %Y';
        }

        const [data] = await pool.execute(`
            SELECT 
                DATE_FORMAT(created_at, ?) as label,
                COALESCE(SUM(total_amount), 0) as total
            FROM bills
            WHERE shop_id = UUID_TO_BIN(?)
            AND DATE(created_at) BETWEEN ? AND ?
            GROUP BY ${groupBy}
            ORDER BY MIN(created_at)
        `, [dateFormat, shopId, startDate, endDate]);

        return {
            labels: data.map(item => item.label),
            data: data.map(item => parseFloat(item.total) || 0)
        };
    } catch (err) {
        console.error('Error getting sales trend:', err);
        return { labels: [], data: [] };
    }
}

// Helper function to get payment methods distribution
async function getPaymentMethods(shopId, startDate, endDate) {
    try {
        const [data] = await pool.execute(`
            SELECT 
                COALESCE(payment_method, 'Cash') as method,
                COALESCE(SUM(total_amount), 0) as total
            FROM bills
            WHERE shop_id = UUID_TO_BIN(?)
            AND DATE(created_at) BETWEEN ? AND ?
            GROUP BY payment_method
            ORDER BY total DESC
        `, [shopId, startDate, endDate]);

        return {
            labels: data.map(item => item.method),
            data: data.map(item => parseFloat(item.total) || 0)
        };
    } catch (err) {
        console.error('Error getting payment methods:', err);
        return { labels: ['Cash'], data: [0] };
    }
}

// API: GET /api/reports/bills/:id - Get bill details
router.get('/api/reports/bills/:id', getShopDetails, async (req, res) => {
    try {
        const billId = req.params.id;

        const [[bill]] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(b.id) as id,
                b.bill_number,
                b.customer_name,
                b.customer_phone,
                b.subtotal,
                b.discount,
                b.tax,
                b.total_amount,
                b.paid_amount,
                b.due_amount,
                b.payment_method,
                b.notes,
                b.created_at,
                u.name as created_by
            FROM bills b
            LEFT JOIN users u ON b.created_by = u.id
            WHERE b.id = UUID_TO_BIN(?)
        `, [billId]);

        if (!bill) {
            return res.status(404).json({
                success: false,
                message: 'Bill not found'
            });
        }

        const [items] = await pool.execute(`
            SELECT 
                bi.quantity,
                bi.unit_price,
                bi.total_price,
                p.name as product_name
            FROM bill_items bi
            LEFT JOIN products p ON bi.product_id = p.id
            WHERE bi.bill_id = UUID_TO_BIN(?)
        `, [billId]);

        res.json({
            success: true,
            bill: bill,
            items: items
        });

    } catch (err) {
        console.error('Error fetching bill details:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load bill details'
        });
    }
});

// API: GET /api/reports/export - Export reports to Excel
router.get('/api/reports/export', getShopDetails, async (req, res) => {
    try {
        const { startDate, endDate, paymentMethod } = req.query;

        const defaultEndDate = new Date();
        const defaultStartDate = new Date();
        defaultStartDate.setDate(defaultEndDate.getDate() - 30);

        const finalStartDate = startDate || defaultStartDate.toISOString().split('T')[0];
        const finalEndDate = endDate || defaultEndDate.toISOString().split('T')[0];

        let whereConditions = ['b.shop_id = UUID_TO_BIN(?)', 'DATE(b.created_at) BETWEEN ? AND ?'];
        let queryParams = [req.session.shopId, finalStartDate, finalEndDate];

        if (paymentMethod && paymentMethod !== 'all') {
            whereConditions.push('b.payment_method = ?');
            queryParams.push(paymentMethod);
        }

        const whereClause = whereConditions.join(' AND ');

        const [reports] = await pool.execute(`
            SELECT 
                b.bill_number,
                b.customer_name,
                b.customer_phone,
                b.subtotal,
                b.discount,
                b.tax,
                b.total_amount,
                b.paid_amount,
                b.due_amount,
                b.payment_method,
                DATE(b.created_at) as bill_date,
                u.name as created_by,
                COALESCE((
                    SELECT COUNT(*) 
                    FROM bill_items bi 
                    WHERE bi.bill_id = b.id
                ), 0) as items_count
            FROM bills b
            LEFT JOIN users u ON b.created_by = u.id
            WHERE ${whereClause}
            ORDER BY b.created_at DESC
        `, queryParams);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Daily Reports');

        worksheet.columns = [
            { header: 'Date', key: 'date', width: 15 },
            { header: 'Bill Number', key: 'bill_number', width: 20 },
            { header: 'Customer', key: 'customer_name', width: 25 },
            { header: 'Phone', key: 'customer_phone', width: 15 },
            { header: 'Items', key: 'items_count', width: 10 },
            { header: 'Subtotal', key: 'subtotal', width: 15 },
            { header: 'Discount', key: 'discount', width: 15 },
            { header: 'Tax', key: 'tax', width: 15 },
            { header: 'Total', key: 'total_amount', width: 15 },
            { header: 'Paid', key: 'paid_amount', width: 15 },
            { header: 'Due', key: 'due_amount', width: 15 },
            { header: 'Payment Method', key: 'payment_method', width: 15 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Created By', key: 'created_by', width: 15 }
        ];

        reports.forEach(report => {
            worksheet.addRow({
                date: new Date(report.bill_date).toLocaleDateString(),
                bill_number: report.bill_number,
                customer_name: report.customer_name || 'Walk-in Customer',
                customer_phone: report.customer_phone || '',
                items_count: report.items_count,
                subtotal: parseFloat(report.subtotal),
                discount: parseFloat(report.discount),
                tax: parseFloat(report.tax),
                total_amount: parseFloat(report.total_amount),
                paid_amount: parseFloat(report.paid_amount),
                due_amount: parseFloat(report.due_amount),
                payment_method: report.payment_method || 'Cash',
                status: parseFloat(report.due_amount) > 0 ? 'Partial' : (parseFloat(report.due_amount) < 0 ? 'Overpaid' : 'Paid'),
                created_by: report.created_by || 'System'
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=daily-reports-${new Date().toISOString().split('T')[0]}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Error exporting reports:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to export reports'
        });
    }
});

// ============================================
// SUPPLIER PAYMENT REPORT
// ============================================

// GET /reports/supplier-payments - Supplier payment report page
router.get('/supplier-payments', getShopDetails, async (req, res) => {
  try {
    res.render('reports/supplier-payments', {
      title: 'Supplier Payment Report',
      shop: req.shop
    });
  } catch (err) {
    console.error('Error loading supplier payments report:', err);
    res.status(500).render('error', { message: 'Failed to load report' });
  }
});

// API: GET /api/reports/supplier-payments - Get supplier payment data
router.get('/api/supplier-payments', getShopDetails, async (req, res) => {
  try {
    const { startDate, endDate, supplierId } = req.query;
    const shopId = req.session.shopId;

    let whereClause = 's.shop_id = UUID_TO_BIN(?)';
    let params = [shopId];

    if (supplierId && supplierId !== 'all') {
      whereClause += ' AND s.id = UUID_TO_BIN(?)';
      params.push(supplierId);
    }

    if (startDate && endDate) {
      whereClause += ' AND DATE(st.created_at) BETWEEN ? AND ?';
      params.push(startDate, endDate);
    }

    // Get supplier payment summary
    const [suppliers] = await pool.execute(`
      SELECT 
        BIN_TO_UUID(s.id) as id,
        s.name,
        s.contact_person,
        s.phone,
        s.email,
        s.type,
        COALESCE((
          SELECT SUM(st.amount) 
          FROM supplier_transactions st 
          WHERE st.supplier_id = s.id 
          AND st.type = 'debit'
          AND (DATE(st.created_at) BETWEEN ? AND ? OR (? IS NULL OR ? IS NULL))
        ), 0) as total_purchases,
        COALESCE((
          SELECT SUM(st.amount) 
          FROM supplier_transactions st 
          WHERE st.supplier_id = s.id 
          AND st.type = 'credit'
          AND (DATE(st.created_at) BETWEEN ? AND ? OR (? IS NULL OR ? IS NULL))
        ), 0) as total_paid,
        COALESCE((
          SELECT SUM(CASE WHEN st.type = 'debit' THEN st.amount ELSE -st.amount END)
          FROM supplier_transactions st 
          WHERE st.supplier_id = s.id
        ), 0) as balance
      FROM suppliers s
      WHERE ${whereClause}
      GROUP BY s.id
      ORDER BY balance DESC
    `, [...params, startDate || null, endDate || null, startDate, endDate, startDate || null, endDate || null, startDate, endDate]);

    // Get detailed transactions for each supplier
    const [transactions] = await pool.execute(`
      SELECT 
        BIN_TO_UUID(st.id) as id,
        BIN_TO_UUID(st.supplier_id) as supplier_id,
        s.name as supplier_name,
        st.type,
        st.amount,
        st.description,
        st.reference_type,
        DATE(st.created_at) as transaction_date,
        st.created_at,
        u.name as created_by
      FROM supplier_transactions st
      JOIN suppliers s ON st.supplier_id = s.id
      LEFT JOIN users u ON st.created_by = u.id
      WHERE s.shop_id = UUID_TO_BIN(?)
      ${startDate && endDate ? 'AND DATE(st.created_at) BETWEEN ? AND ?' : ''}
      ORDER BY st.created_at DESC
      LIMIT 200
    `, startDate && endDate ? [shopId, startDate, endDate] : [shopId]);

    // Calculate summary
    const summary = {
      totalSuppliers: suppliers.length,
      totalPurchases: suppliers.reduce((sum, s) => sum + parseFloat(s.total_purchases), 0),
      totalPaid: suppliers.reduce((sum, s) => sum + parseFloat(s.total_paid), 0),
      totalBalance: suppliers.reduce((sum, s) => sum + parseFloat(s.balance), 0)
    };

    res.json({
      success: true,
      suppliers: suppliers,
      transactions: transactions,
      summary: summary
    });

  } catch (err) {
    console.error('Error loading supplier payments:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================
// USER SALES REPORT
// ============================================

// GET /reports/user-sales - User sales report page
router.get('/user-sales', getShopDetails, async (req, res) => {
  try {
    res.render('reports/user-sales', {
      title: 'User Sales Report',
      shop: req.shop
    });
  } catch (err) {
    console.error('Error loading user sales report:', err);
    res.status(500).render('error', { message: 'Failed to load report' });
  }
});

// API: GET /api/reports/user-sales - Get user sales data
router.get('/api/user-sales', getShopDetails, async (req, res) => {
  try {
    const { startDate, endDate, userId, period = 'daily' } = req.query;
    const shopId = req.session.shopId;

    // Get sales by user
    const [userSales] = await pool.execute(`
      SELECT 
        BIN_TO_UUID(u.id) as id,
        u.name,
        u.email,
        u.phone,
        r.role_name as role,
        COUNT(b.id) as total_bills,
        COALESCE(SUM(b.total_amount), 0) as total_sales,
        COALESCE(SUM(b.discount), 0) as total_discounts,
        COALESCE(SUM(b.tax), 0) as total_tax,
        COALESCE(AVG(b.total_amount), 0) as avg_bill_value,
        MIN(b.created_at) as first_sale,
        MAX(b.created_at) as last_sale
      FROM users u
      LEFT JOIN bills b ON b.created_by = u.id AND b.shop_id = UUID_TO_BIN(?)
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.shop_id = UUID_TO_BIN(?)
      ${startDate && endDate ? 'AND DATE(b.created_at) BETWEEN ? AND ?' : ''}
      GROUP BY u.id
      HAVING total_bills > 0 OR total_sales > 0
      ORDER BY total_sales DESC
    `, startDate && endDate ? [shopId, shopId, startDate, endDate] : [shopId, shopId]);

    // Get detailed sales by user with time breakdown
    let timeGroupBy, dateFormat;
    switch(period) {
      case 'daily':
        timeGroupBy = 'DATE(b.created_at)';
        dateFormat = '%Y-%m-%d';
        break;
      case 'weekly':
        timeGroupBy = 'YEARWEEK(b.created_at)';
        dateFormat = 'Week %v, %Y';
        break;
      case 'monthly':
        timeGroupBy = 'DATE_FORMAT(b.created_at, "%Y-%m")';
        dateFormat = '%M %Y';
        break;
      default:
        timeGroupBy = 'DATE(b.created_at)';
        dateFormat = '%Y-%m-%d';
    }

    const [salesByPeriod] = await pool.execute(`
      SELECT 
        DATE_FORMAT(b.created_at, ?) as period,
        u.name as user_name,
        COUNT(b.id) as bill_count,
        COALESCE(SUM(b.total_amount), 0) as total
      FROM bills b
      JOIN users u ON b.created_by = u.id
      WHERE b.shop_id = UUID_TO_BIN(?)
      ${startDate && endDate ? 'AND DATE(b.created_at) BETWEEN ? AND ?' : ''}
      GROUP BY ${timeGroupBy}, u.id
      ORDER BY b.created_at DESC
    `, dateFormat && startDate && endDate ? [dateFormat, shopId, startDate, endDate] : [dateFormat, shopId]);

    // Calculate summary
    const summary = {
      totalUsers: userSales.length,
      totalSales: userSales.reduce((sum, u) => sum + parseFloat(u.total_sales), 0),
      totalBills: userSales.reduce((sum, u) => sum + parseInt(u.total_bills), 0),
      avgBillValue: userSales.length > 0 ? userSales.reduce((sum, u) => sum + parseFloat(u.avg_bill_value), 0) / userSales.length : 0
    };

    res.json({
      success: true,
      userSales: userSales,
      salesByPeriod: salesByPeriod,
      summary: summary
    });

  } catch (err) {
    console.error('Error loading user sales:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================
// PRODUCT SALES REPORT
// ============================================

// GET /reports/product-sales - Product sales report page
router.get('/product-sales', getShopDetails, async (req, res) => {
  try {
    res.render('reports/product-sales', {
      title: 'Product Sales Report',
      shop: req.shop
    });
  } catch (err) {
    console.error('Error loading product sales report:', err);
    res.status(500).render('error', { message: 'Failed to load report' });
  }
});

// API: GET /api/reports/product-sales - Get product sales data
router.get('/api/product-sales', getShopDetails, async (req, res) => {
  try {
    const { startDate, endDate, category, sortBy = 'quantity' } = req.query;
    const shopId = req.session.shopId;

    let whereClause = 'b.shop_id = UUID_TO_BIN(?)';
    let params = [shopId];

    if (startDate && endDate) {
      whereClause += ' AND DATE(b.created_at) BETWEEN ? AND ?';
      params.push(startDate, endDate);
    }

    if (category && category !== 'all') {
      whereClause += ' AND p.category = ?';
      params.push(category);
    }

    // Get product sales data
    const [products] = await pool.execute(`
      SELECT 
        BIN_TO_UUID(p.id) as id,
        p.name,
        p.brand,
        p.category,
        p.sku,
        p.status,
        COUNT(DISTINCT b.id) as times_sold,
        SUM(bi.quantity) as total_quantity_sold,
        COALESCE(SUM(bi.total_price), 0) as total_revenue,
        COALESCE(AVG(bi.unit_price), 0) as avg_selling_price,
        COALESCE(AVG(i.current_quantity), 0) as current_stock,
        SUM(bi.total_price) / NULLIF(SUM(bi.quantity), 0) as avg_price_per_unit
      FROM products p
      LEFT JOIN bill_items bi ON bi.product_id = p.id
      LEFT JOIN bills b ON bi.bill_id = b.id AND ${whereClause}
      LEFT JOIN inventory i ON i.product_id = p.id
      WHERE p.shop_id = UUID_TO_BIN(?)
      GROUP BY p.id
      HAVING total_quantity_sold > 0 OR total_revenue > 0
      ORDER BY 
        CASE ? 
          WHEN 'quantity' THEN total_quantity_sold 
          WHEN 'revenue' THEN total_revenue 
          WHEN 'times' THEN times_sold 
          ELSE total_quantity_sold 
        END DESC
    `, [...params, shopId, sortBy]);

    // Get categories for filter
    const [categories] = await pool.execute(`
      SELECT DISTINCT category 
      FROM products 
      WHERE shop_id = UUID_TO_BIN(?) AND category IS NOT NULL AND category != ''
      ORDER BY category
    `, [shopId]);

    // Get top products by revenue
    const [topProducts] = await pool.execute(`
      SELECT 
        p.name,
        SUM(bi.quantity) as quantity,
        SUM(bi.total_price) as revenue
      FROM bill_items bi
      JOIN products p ON bi.product_id = p.id
      JOIN bills b ON bi.bill_id = b.id
      WHERE b.shop_id = UUID_TO_BIN(?)
      ${startDate && endDate ? 'AND DATE(b.created_at) BETWEEN ? AND ?' : ''}
      GROUP BY p.id
      ORDER BY revenue DESC
      LIMIT 10
    `, startDate && endDate ? [shopId, startDate, endDate] : [shopId]);

    // Summary
    const summary = {
      totalProducts: products.length,
      totalQuantitySold: products.reduce((sum, p) => sum + parseFloat(p.total_quantity_sold), 0),
      totalRevenue: products.reduce((sum, p) => sum + parseFloat(p.total_revenue), 0),
      avgPrice: products.length > 0 ? products.reduce((sum, p) => sum + parseFloat(p.avg_price_per_unit), 0) / products.length : 0
    };

    res.json({
      success: true,
      products: products,
      categories: categories.map(c => c.category),
      topProducts: topProducts,
      summary: summary
    });

  } catch (err) {
    console.error('Error loading product sales:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================
// RAW MATERIAL CONSUMPTION REPORT
// ============================================

// GET /reports/raw-consumption - Raw material consumption report
router.get('/raw-consumption', getShopDetails, async (req, res) => {
  try {
    res.render('reports/raw-consumption', {
      title: 'Raw Material Consumption Report',
      shop: req.shop
    });
  } catch (err) {
    console.error('Error loading raw consumption report:', err);
    res.status(500).render('error', { message: 'Failed to load report' });
  }
});

// API: GET /api/reports/raw-consumption - Get raw material consumption data
router.get('/api/raw-consumption', getShopDetails, async (req, res) => {
  try {
    const { startDate, endDate, category } = req.query;
    const shopId = req.session.shopId;

    let whereClause = 'rm.shop_id = UUID_TO_BIN(?)';
    let params = [shopId];

    if (category && category !== 'all') {
      whereClause += ' AND rm.category = ?';
      params.push(category);
    }

    // Get raw materials with consumption data
    const [rawMaterials] = await pool.execute(`
      SELECT 
        BIN_TO_UUID(rm.id) as id,
        rm.name,
        rm.sku,
        rm.category,
        rm.unit_of_measure,
        rm.current_stock,
        rm.min_stock_level,
        rm.max_stock_level,
        rm.cost_price,
        COALESCE((
          SELECT SUM(CASE WHEN movement_type = 'in' THEN quantity ELSE 0 END)
          FROM raw_material_stock_movements 
          WHERE raw_material_id = rm.id
          ${startDate && endDate ? 'AND movement_date BETWEEN ? AND ?' : ''}
        ), 0) as total_incoming,
        COALESCE((
          SELECT SUM(CASE WHEN movement_type = 'out' THEN quantity ELSE 0 END)
          FROM raw_material_stock_movements 
          WHERE raw_material_id = rm.id
          ${startDate && endDate ? 'AND movement_date BETWEEN ? AND ?' : ''}
        ), 0) as total_outgoing,
        COALESCE((
          SELECT SUM(CASE 
            WHEN movement_type = 'out' AND reference_type = 'production' THEN quantity 
            ELSE 0 
          END)
          FROM raw_material_stock_movements 
          WHERE raw_material_id = rm.id
          ${startDate && endDate ? 'AND movement_date BETWEEN ? AND ?' : ''}
        ), 0) as total_used_in_production,
        (rm.current_stock * rm.cost_price) as stock_value
      FROM raw_materials rm
      WHERE ${whereClause}
      ORDER BY total_outgoing DESC
    `, startDate && endDate ? [...params, startDate, endDate, startDate, endDate, startDate, endDate] : params);

    // Get consumption by product
    const [consumptionByProduct] = await pool.execute(`
      SELECT 
        p.name as product_name,
        rm.name as raw_material,
        i.quantity_required,
        i.unit,
        COUNT(DISTINCT b.id) as times_produced,
        SUM(bi.quantity) * i.quantity_required as expected_consumption
      FROM ingredients i
      JOIN products p ON i.main_product_id = p.id
      JOIN raw_materials rm ON i.raw_material_id = rm.id
      JOIN bill_items bi ON bi.product_id = p.id
      JOIN bills b ON bi.bill_id = b.id
      WHERE b.shop_id = UUID_TO_BIN(?)
      ${startDate && endDate ? 'AND DATE(b.created_at) BETWEEN ? AND ?' : ''}
      GROUP BY p.id, rm.id
      ORDER BY expected_consumption DESC
      LIMIT 20
    `, startDate && endDate ? [shopId, startDate, endDate] : [shopId]);

    // Get categories
    const [categories] = await pool.execute(`
      SELECT DISTINCT category 
      FROM raw_materials 
      WHERE shop_id = UUID_TO_BIN(?) AND category IS NOT NULL
      ORDER BY category
    `, [shopId]);

    // Summary
    const summary = {
      totalMaterials: rawMaterials.length,
      totalIncoming: rawMaterials.reduce((sum, rm) => sum + parseFloat(rm.total_incoming), 0),
      totalOutgoing: rawMaterials.reduce((sum, rm) => sum + parseFloat(rm.total_outgoing), 0),
      totalUsedInProduction: rawMaterials.reduce((sum, rm) => sum + parseFloat(rm.total_used_in_production), 0),
      totalStockValue: rawMaterials.reduce((sum, rm) => sum + parseFloat(rm.stock_value), 0),
      lowStockCount: rawMaterials.filter(rm => rm.current_stock <= rm.min_stock_level).length
    };

    res.json({
      success: true,
      rawMaterials: rawMaterials,
      consumptionByProduct: consumptionByProduct,
      categories: categories.map(c => c.category),
      summary: summary
    });

  } catch (err) {
    console.error('Error loading raw consumption:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================
// EXPORT FUNCTIONS
// ============================================

// Export supplier payments report
router.get('/export/supplier-payments', getShopDetails, async (req, res) => {
  try {
    const { startDate, endDate, supplierId } = req.query;
    const shopId = req.session.shopId;

    let whereClause = 's.shop_id = UUID_TO_BIN(?)';
    let params = [shopId];

    if (supplierId && supplierId !== 'all') {
      whereClause += ' AND s.id = UUID_TO_BIN(?)';
      params.push(supplierId);
    }

    const [suppliers] = await pool.execute(`
      SELECT 
        s.name,
        s.contact_person,
        s.phone,
        s.email,
        COALESCE((
          SELECT SUM(st.amount) 
          FROM supplier_transactions st 
          WHERE st.supplier_id = s.id AND st.type = 'debit'
        ), 0) as total_purchases,
        COALESCE((
          SELECT SUM(st.amount) 
          FROM supplier_transactions st 
          WHERE st.supplier_id = s.id AND st.type = 'credit'
        ), 0) as total_paid,
        COALESCE((
          SELECT SUM(CASE WHEN st.type = 'debit' THEN st.amount ELSE -st.amount END)
          FROM supplier_transactions st 
          WHERE st.supplier_id = s.id
        ), 0) as balance
      FROM suppliers s
      WHERE ${whereClause}
      ORDER BY balance DESC
    `, params);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Supplier Payments');

    worksheet.columns = [
      { header: 'Supplier Name', key: 'name', width: 25 },
      { header: 'Contact Person', key: 'contact_person', width: 20 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Total Purchases', key: 'total_purchases', width: 18 },
      { header: 'Total Paid', key: 'total_paid', width: 15 },
      { header: 'Balance', key: 'balance', width: 15 }
    ];

    suppliers.forEach(supplier => {
      worksheet.addRow({
        name: supplier.name,
        contact_person: supplier.contact_person || '-',
        phone: supplier.phone || '-',
        email: supplier.email || '-',
        total_purchases: parseFloat(supplier.total_purchases).toFixed(2),
        total_paid: parseFloat(supplier.total_paid).toFixed(2),
        balance: parseFloat(supplier.balance).toFixed(2)
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=supplier-payments-${new Date().toISOString().split('T')[0]}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Error exporting supplier payments:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;