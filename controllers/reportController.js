const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const ExcelJS = require('exceljs');

// Middleware to get shop-specific details
const getShopDetails = async (req, res, next) => {
    if (!req.session.shopId) {
        return res.status(403).json({ success: false, message: 'Shop not identified' });
    }

    try {
        const [shops] = await pool.execute(
            'SELECT * FROM shops WHERE id = UUID_TO_BIN(?)',
            [req.session.shopId]
        );

        if (shops.length === 0) {
            return res.status(404).json({ success: false, message: 'Shop not found' });
        }

        req.shop = {
            id: req.session.shopId,
            name: shops[0].name || 'My Shop',
            logo: shops[0].logo ? `/uploads/${shops[0].logo}` : '/images/default-logo.png',
            currency: shops[0].currency || 'PKR',
            primary_color: shops[0].primary_color || '#007bff',
            secondary_color: shops[0].secondary_color || '#6c757d'
        };

        next();
    } catch (err) {
        console.error('Error fetching shop details:', err);
        res.status(500).json({ success: false, message: 'Error fetching shop details' });
    }
};

// GET /reports - Main reports page
router.get('/', getShopDetails, async (req, res) => {
    try {
        // Get date range from query or default to current month
        const fromDate = req.query.fromDate || new Date().toISOString().slice(0, 8) + '01';
        const toDate = req.query.toDate || new Date().toISOString().slice(0, 10);
        
        // Get basic stats for dashboard
        const [[billStats]] = await pool.execute(`
            SELECT 
                COUNT(*) as totalBills,
                SUM(total_amount) as totalRevenue,
                AVG(total_amount) as averageBill,
                MIN(created_at) as firstBillDate,
                MAX(created_at) as lastBillDate
            FROM bills 
            WHERE shop_id = UUID_TO_BIN(?) 
            AND DATE(created_at) BETWEEN ? AND ?
        `, [req.session.shopId, fromDate, toDate]);

        const [[productStats]] = await pool.execute(`
            SELECT 
                COUNT(*) as totalProducts,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as activeProducts,
                SUM(current_quantity) as totalStock
            FROM products p
            LEFT JOIN inventory i ON p.id = i.product_id
            WHERE p.shop_id = UUID_TO_BIN(?)
        `, [req.session.shopId]);

        const [[supplierStats]] = await pool.execute(`
            SELECT 
                COUNT(*) as totalSuppliers,
                COUNT(CASE WHEN type = 'product' THEN 1 END) as productSuppliers,
                COUNT(CASE WHEN type = 'raw_material' THEN 1 END) as rawMaterialSuppliers
            FROM suppliers 
            WHERE shop_id = UUID_TO_BIN(?) AND status = 'active'
        `, [req.session.shopId]);

        const [[employeeStats]] = await pool.execute(`
            SELECT 
                COUNT(*) as totalEmployees,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as activeEmployees,
                SUM(salary) as totalSalary,
                AVG(salary) as averageSalary
            FROM users 
            WHERE shop_id = UUID_TO_BIN(?)
        `, [req.session.shopId]);

        const [[rawMaterialStats]] = await pool.execute(`
            SELECT 
                COUNT(*) as totalRawMaterials,
                SUM(current_stock) as totalStock,
                SUM(current_stock * cost_price) as stockValue
            FROM raw_materials 
            WHERE shop_id = UUID_TO_BIN(?) AND is_active = TRUE
        `, [req.session.shopId]);

        res.render('reports', {
            title: 'Reports & Analytics',
            shop: req.shop,
            query: req.query,
            stats: {
                bills: billStats,
                products: productStats,
                suppliers: supplierStats,
                employees: employeeStats,
                rawMaterials: rawMaterialStats
            },
            fromDate: fromDate,
            toDate: toDate
        });

    } catch (err) {
        console.error('Error loading reports:', err);
        res.status(500).render('error', {
            message: 'Failed to load reports',
            shop: req.shop
        });
    }
});

// GET /reports/bills - Bills report
// router.get('/bills', getShopDetails, async (req, res) => {
//     try {
//         const fromDate = req.query.fromDate || new Date().toISOString().slice(0, 8) + '01';
//         const toDate = req.query.toDate || new Date().toISOString().slice(0, 10);
//         const type = req.query.type || 'daily'; // daily, weekly, monthly

//         let dateFormat, groupBy;
//         switch(type) {
//             case 'daily':
//                 dateFormat = '%Y-%m-%d';
//                 groupBy = 'DATE(created_at)';
//                 break;
//             case 'weekly':
//                 dateFormat = '%Y-%U';
//                 groupBy = 'YEARWEEK(created_at)';
//                 break;
//             case 'monthly':
//                 dateFormat = '%Y-%m';
//                 groupBy = 'DATE_FORMAT(created_at, "%Y-%m")';
//                 break;
//         }

//         // Get bills summary by date
//         const [billsByDate] = await pool.execute(`
//             SELECT 
//                 DATE_FORMAT(created_at, ?) as period,
//                 COUNT(*) as billCount,
//                 SUM(total_amount) as totalRevenue,
//                 SUM(paid_amount) as totalPaid,
//                 SUM(due_amount) as totalDue,
//                 AVG(total_amount) as averageBill
//             FROM bills 
//             WHERE shop_id = UUID_TO_BIN(?) 
//             AND DATE(created_at) BETWEEN ? AND ?
//             GROUP BY ${groupBy}
//             ORDER BY created_at DESC
//         `, [dateFormat, req.session.shopId, fromDate, toDate]);

//         // Get top products
//         const [topProducts] = await pool.execute(`
//             SELECT 
//                 p.name as productName,
//                 COUNT(bi.id) as saleCount,
//                 SUM(bi.quantity) as totalQuantity,
//                 SUM(bi.total_price) as totalRevenue
//             FROM bill_items bi
//             JOIN products p ON bi.product_id = p.id
//             JOIN bills b ON bi.bill_id = b.id
//             WHERE b.shop_id = UUID_TO_BIN(?) 
//             AND DATE(b.created_at) BETWEEN ? AND ?
//             GROUP BY p.id
//             ORDER BY totalRevenue DESC
//             LIMIT 10
//         `, [req.session.shopId, fromDate, toDate]);

//         // Get payment method distribution
//         const [paymentMethods] = await pool.execute(`
//             SELECT 
//                 COALESCE(payment_method, 'unknown') as method,
//                 COUNT(*) as billCount,
//                 SUM(total_amount) as totalAmount
//             FROM bills 
//             WHERE shop_id = UUID_TO_BIN(?) 
//             AND DATE(created_at) BETWEEN ? AND ?
//             GROUP BY payment_method
//         `, [req.session.shopId, fromDate, toDate]);

//         // Get detailed bills
//         const [bills] = await pool.execute(`
//             SELECT 
//                 b.bill_number,
//                 b.customer_name,
//                 b.customer_phone,
//                 b.subtotal,
//                 b.discount,
//                 b.tax,
//                 b.total_amount,
//                 b.paid_amount,
//                 b.due_amount,
//                 b.payment_method,
//                 DATE(b.created_at) as bill_date,
//                 u.name as created_by
//             FROM bills b
//             LEFT JOIN users u ON b.created_by = u.id
//             WHERE b.shop_id = UUID_TO_BIN(?) 
//             AND DATE(b.created_at) BETWEEN ? AND ?
//             ORDER BY b.created_at DESC
//             LIMIT 100
//         `, [req.session.shopId, fromDate, toDate]);

//         res.json({
//             success: true,
//             billsByDate: billsByDate,
//             topProducts: topProducts,
//             paymentMethods: paymentMethods,
//             bills: bills,
//             summary: {
//                 totalBills: billsByDate.reduce((sum, item) => sum + item.billCount, 0),
//                 totalRevenue: billsByDate.reduce((sum, item) => sum + parseFloat(item.totalRevenue), 0),
//                 totalDue: billsByDate.reduce((sum, item) => sum + parseFloat(item.totalDue), 0)
//             }
//         });

//     } catch (err) {
//         console.error('Error loading bills report:', err);
//         res.status(500).json({
//             success: false,
//             message: 'Failed to load bills report'
//         });
//     }
// });
// GET /reports/bills - Bills report
router.get('/bills', getShopDetails, async (req, res) => {
    try {
        const fromDate = req.query.fromDate || new Date().toISOString().slice(0, 8) + '01';
        const toDate = req.query.toDate || new Date().toISOString().slice(0, 10);
        const type = req.query.type || 'daily';

        let dateFormat, groupBy;
        switch(type) {
            case 'daily':
                dateFormat = '%Y-%m-%d';
                groupBy = 'DATE(created_at)';
                break;
            case 'weekly':
                dateFormat = '%Y-%U';
                groupBy = 'YEARWEEK(created_at)';
                break;
            case 'monthly':
                dateFormat = '%Y-%m';
                groupBy = 'DATE_FORMAT(created_at, "%Y-%m")';
                break;
            case 'yearly':
                dateFormat = '%Y';
                groupBy = 'YEAR(created_at)';
                break;
        }

        // Get bills summary by date
        const [billsByDate] = await pool.execute(`
            SELECT 
                DATE_FORMAT(created_at, ?) as period,
                COUNT(*) as billCount,
                SUM(total_amount) as totalRevenue,
                SUM(paid_amount) as totalPaid,
                SUM(due_amount) as totalDue,
                AVG(total_amount) as averageBill
            FROM bills 
            WHERE shop_id = UUID_TO_BIN(?) 
            AND DATE(created_at) BETWEEN ? AND ?
            GROUP BY ${groupBy}
            ORDER BY created_at DESC
        `, [dateFormat, req.session.shopId, fromDate, toDate]);

        // Get top products
        const [topProducts] = await pool.execute(`
            SELECT 
                p.name as productName,
                COUNT(bi.id) as saleCount,
                SUM(bi.quantity) as totalQuantity,
                SUM(bi.total_price) as totalRevenue
            FROM bill_items bi
            JOIN products p ON bi.product_id = p.id
            JOIN bills b ON bi.bill_id = b.id
            WHERE b.shop_id = UUID_TO_BIN(?) 
            AND DATE(b.created_at) BETWEEN ? AND ?
            GROUP BY p.id
            ORDER BY totalRevenue DESC
            LIMIT 10
        `, [req.session.shopId, fromDate, toDate]);

        // Get payment method distribution
        const [paymentMethods] = await pool.execute(`
            SELECT 
                COALESCE(payment_method, 'unknown') as method,
                COUNT(*) as billCount,
                SUM(total_amount) as totalAmount
            FROM bills 
            WHERE shop_id = UUID_TO_BIN(?) 
            AND DATE(created_at) BETWEEN ? AND ?
            GROUP BY payment_method
        `, [req.session.shopId, fromDate, toDate]);

        // Get detailed bills
        const [bills] = await pool.execute(`
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
                u.name as created_by
            FROM bills b
            LEFT JOIN users u ON b.created_by = u.id
            WHERE b.shop_id = UUID_TO_BIN(?) 
            AND DATE(b.created_at) BETWEEN ? AND ?
            ORDER BY b.created_at DESC
            LIMIT 100
        `, [req.session.shopId, fromDate, toDate]);

        // Calculate summary
        const summary = {
            totalBills: billsByDate.reduce((sum, item) => sum + (parseInt(item.billCount) || 0), 0),
            totalRevenue: billsByDate.reduce((sum, item) => sum + (parseFloat(item.totalRevenue) || 0), 0),
            totalDue: billsByDate.reduce((sum, item) => sum + (parseFloat(item.totalDue) || 0), 0)
        };

        res.json({
            success: true,
            billsByDate: billsByDate,
            topProducts: topProducts,
            paymentMethods: paymentMethods,
            bills: bills,
            summary: summary
        });

    } catch (err) {
        console.error('Error loading bills report:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load bills report'
        });
    }
});

// GET /reports/products - Products report
// router.get('/products', getShopDetails, async (req, res) => {
//     try {
//         const category = req.query.category || 'all';
//         const lowStock = req.query.lowStock === 'true';

//         let whereClause = 'p.shop_id = UUID_TO_BIN(?)';
//         const params = [req.session.shopId];

//         if (category !== 'all') {
//             whereClause += ' AND p.category = ?';
//             params.push(category);
//         }

//         if (lowStock) {
//             whereClause += ' AND i.current_quantity <= i.min_stock_level';
//         }

//         // Get products with inventory
//         const [products] = await pool.execute(`
//             SELECT 
//                 BIN_TO_UUID(p.id) as id,
//                 p.name,
//                 p.brand,
//                 p.category,
//                 p.sku,
//                 p.barcode,
//                 p.status,
//                 i.current_quantity,
//                 i.avg_cost,
//                 i.selling_price,
//                 i.last_buying_price,
//                 (i.current_quantity * i.selling_price) as stock_value
//             FROM products p
//             LEFT JOIN inventory i ON p.id = i.product_id
//             WHERE ${whereClause}
//             ORDER BY p.name
//         `, params);

//         // Get categories for filter
//         const [categories] = await pool.execute(`
//             SELECT DISTINCT category 
//             FROM products 
//             WHERE shop_id = UUID_TO_BIN(?) AND category IS NOT NULL
//             ORDER BY category
//         `, [req.session.shopId]);

//         // Get stock movements
//         const [stockMovements] = await pool.execute(`
//             SELECT 
//                 si.batch_number,
//                 p.name as product_name,
//                 si.quantity,
//                 si.unit_price,
//                 si.buying_price,
//                 si.selling_price,
//                 si.expiry_date,
//                 DATE(si.created_at) as received_date,
//                 s.name as supplier_name
//             FROM stock_in si
//             JOIN products p ON si.product_id = p.id
//             LEFT JOIN suppliers s ON si.supplier_id = s.id
//             WHERE si.shop_id = UUID_TO_BIN(?)
//             ORDER BY si.created_at DESC
//             LIMIT 50
//         `, [req.session.shopId]);

//         // Get sales data for products
//         const [productSales] = await pool.execute(`
//             SELECT 
//                 p.name,
//                 p.category,
//                 COUNT(bi.id) as sale_count,
//                 SUM(bi.quantity) as total_quantity,
//                 SUM(bi.total_price) as total_revenue,
//                 AVG(bi.unit_price) as average_price
//             FROM bill_items bi
//             JOIN products p ON bi.product_id = p.id
//             JOIN bills b ON bi.bill_id = b.id
//             WHERE b.shop_id = UUID_TO_BIN(?)
//             AND b.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
//             GROUP BY p.id
//             ORDER BY total_revenue DESC
//         `, [req.session.shopId]);

//         res.json({
//             success: true,
//             products: products,
//             categories: categories.map(c => c.category),
//             stockMovements: stockMovements,
//             productSales: productSales,
//             summary: {
//                 totalProducts: products.length,
//                 totalStockValue: products.reduce((sum, p) => sum + (parseFloat(p.stock_value) || 0), 0),
//                 lowStockCount: products.filter(p => p.current_quantity <= (p.min_stock_level || 0)).length
//             }
//         });

//     } catch (err) {
//         console.error('Error loading products report:', err);
//         res.status(500).json({
//             success: false,
//             message: 'Failed to load products report'
//         });
//     }
// });
// GET /reports/products - Products report
router.get('/products', getShopDetails, async (req, res) => {
    try {
        const category = req.query.category || 'all';
        const lowStock = req.query.lowStock === 'true';

        let whereClause = 'p.shop_id = UUID_TO_BIN(?)';
        const params = [req.session.shopId];

        if (category !== 'all') {
            whereClause += ' AND p.category = ?';
            params.push(category);
        }

        if (lowStock) {
            whereClause += ' AND COALESCE(i.current_quantity, 0) <= 5';
        }

        // Get products with inventory - Fixed: products table doesn't have min_stock_level
        const [products] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(p.id) as id,
                p.name,
                p.brand,
                p.category,
                p.sku,
                p.barcode,
                p.status,
                COALESCE(i.current_quantity, 0) as current_quantity,
                COALESCE(i.avg_cost, 0) as avg_cost,
                COALESCE(i.selling_price, 0) as selling_price,
                COALESCE(i.last_buying_price, 0) as last_buying_price,
                (COALESCE(i.current_quantity, 0) * COALESCE(i.selling_price, 0)) as stock_value
            FROM products p
            LEFT JOIN inventory i ON p.id = i.product_id
            WHERE ${whereClause}
            ORDER BY p.name
        `, params);

        // Get categories for filter
        const [categories] = await pool.execute(`
            SELECT DISTINCT category 
            FROM products 
            WHERE shop_id = UUID_TO_BIN(?) AND category IS NOT NULL AND category != ''
            ORDER BY category
        `, [req.session.shopId]);

        // Get stock movements
        const [stockMovements] = await pool.execute(`
            SELECT 
                si.batch_number,
                p.name as product_name,
                si.quantity,
                si.buying_price,
                si.selling_price,
                si.expiry_date,
                DATE(si.created_at) as received_date,
                s.name as supplier_name
            FROM stock_in si
            JOIN products p ON si.product_id = p.id
            LEFT JOIN suppliers s ON si.supplier_id = s.id
            WHERE si.shop_id = UUID_TO_BIN(?)
            ORDER BY si.created_at DESC
            LIMIT 50
        `, [req.session.shopId]);

        // Get sales data for products
        const [productSales] = await pool.execute(`
            SELECT 
                p.name,
                p.category,
                COUNT(bi.id) as sale_count,
                SUM(bi.quantity) as total_quantity,
                SUM(bi.total_price) as total_revenue,
                AVG(bi.unit_price) as average_price
            FROM bill_items bi
            JOIN products p ON bi.product_id = p.id
            JOIN bills b ON bi.bill_id = b.id
            WHERE b.shop_id = UUID_TO_BIN(?)
            AND b.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY p.id
            ORDER BY total_revenue DESC
        `, [req.session.shopId]);

        // Calculate summary
        const summary = {
            totalProducts: products.length,
            totalStockValue: products.reduce((sum, p) => sum + (parseFloat(p.stock_value) || 0), 0),
            lowStockCount: products.filter(p => p.current_quantity <= 5).length
        };

        res.json({
            success: true,
            products: products,
            categories: categories.map(c => c.category),
            stockMovements: stockMovements,
            productSales: productSales,
            summary: summary
        });

    } catch (err) {
        console.error('Error loading products report:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load products report'
        });
    }
});


// GET /reports/suppliers - Suppliers report
// router.get('/suppliers', getShopDetails, async (req, res) => {
//     try {
//         const type = req.query.type || 'all';
//         const withBalance = req.query.withBalance === 'true';

//         let whereClause = 's.shop_id = UUID_TO_BIN(?) AND s.status = "active"';
//         const params = [req.session.shopId];

//         if (type !== 'all') {
//             whereClause += ' AND s.type = ?';
//             params.push(type);
//         }

//         // Get suppliers
//         const [suppliers] = await pool.execute(`
//             SELECT 
//                 BIN_TO_UUID(s.id) as id,
//                 s.name,
//                 s.contact_person,
//                 s.phone,
//                 s.email,
//                 s.type,
//                 s.city,
//                 s.country,
//                 s.account_number,
//                 s.bank_name,
//                 s.payment_terms,
//                 COALESCE(sb.total_debit, 0) as total_debit,
//                 COALESCE(sb.total_credit, 0) as total_credit,
//                 COALESCE(sb.balance, 0) as balance
//             FROM suppliers s
//             LEFT JOIN supplier_balance sb ON s.id = sb.supplier_id
//             WHERE ${whereClause}
//             ORDER BY s.name
//         `, params);

//         // Get supplier transactions
//         const [transactions] = await pool.execute(`
//             SELECT 
//                 st.type,
//                 st.amount,
//                 st.description,
//                 DATE(st.created_at) as transaction_date,
//                 s.name as supplier_name,
//                 u.name as created_by
//             FROM supplier_transactions st
//             JOIN suppliers s ON st.supplier_id = s.id
//             LEFT JOIN users u ON st.created_by = u.id
//             WHERE st.shop_id = UUID_TO_BIN(?)
//             ORDER BY st.created_at DESC
//             LIMIT 100
//         `, [req.session.shopId]);

//         // Get supplier purchase summary
//         const [purchaseSummary] = await pool.execute(`
//             SELECT 
//                 s.name as supplier_name,
//                 COUNT(si.id) as purchase_count,
//                 SUM(si.quantity * si.buying_price) as total_purchase,
//                 MAX(si.created_at) as last_purchase
//             FROM stock_in si
//             JOIN suppliers s ON si.supplier_id = s.id
//             WHERE si.shop_id = UUID_TO_BIN(?)
//             GROUP BY s.id
//             ORDER BY total_purchase DESC
//         `, [req.session.shopId]);

//         res.json({
//             success: true,
//             suppliers: suppliers,
//             transactions: transactions,
//             purchaseSummary: purchaseSummary,
//             summary: {
//                 totalSuppliers: suppliers.length,
//                 totalBalance: suppliers.reduce((sum, s) => sum + parseFloat(s.balance), 0),
//                 totalDebit: suppliers.reduce((sum, s) => sum + parseFloat(s.total_debit), 0),
//                 totalCredit: suppliers.reduce((sum, s) => sum + parseFloat(s.total_credit), 0)
//             }
//         });

//     } catch (err) {
//         console.error('Error loading suppliers report:', err);
//         res.status(500).json({
//             success: false,
//             message: 'Failed to load suppliers report'
//         });
//     }
// });
// GET /reports/suppliers - Suppliers report
router.get('/suppliers', getShopDetails, async (req, res) => {
    try {
        const type = req.query.type || 'all';
        const withBalance = req.query.withBalance === 'true';

        let whereClause = 's.shop_id = UUID_TO_BIN(?) AND s.status = "active"';
        const params = [req.session.shopId];

        if (type !== 'all') {
            whereClause += ' AND s.type = ?';
            params.push(type);
        }

        // Get suppliers - Updated query to handle missing supplier_balance table
        const [suppliers] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(s.id) as id,
                s.name,
                s.contact_person,
                s.phone,
                s.email,
                s.type,
                s.city,
                s.country,
                s.account_number,
                s.bank_name,
                s.payment_terms,
                COALESCE((
                    SELECT SUM(st.amount) 
                    FROM supplier_transactions st 
                    WHERE st.supplier_id = s.id AND st.type = 'debit'
                ), 0) as total_debit,
                COALESCE((
                    SELECT SUM(st.amount) 
                    FROM supplier_transactions st 
                    WHERE st.supplier_id = s.id AND st.type = 'credit'
                ), 0) as total_credit,
                COALESCE((
                    SELECT SUM(CASE WHEN st.type = 'debit' THEN st.amount ELSE -st.amount END)
                    FROM supplier_transactions st 
                    WHERE st.supplier_id = s.id
                ), 0) as balance
            FROM suppliers s
            WHERE ${whereClause}
            ORDER BY s.name
        `, params);

        // Get supplier transactions - Fixed query
        const [transactions] = await pool.execute(`
            SELECT 
                st.type,
                st.amount,
                st.description,
                DATE(st.created_at) as transaction_date,
                s.name as supplier_name,
                u.name as created_by
            FROM supplier_transactions st
            JOIN suppliers s ON st.supplier_id = s.id
            LEFT JOIN users u ON st.created_by = u.id
            WHERE st.shop_id = UUID_TO_BIN(?)
            ORDER BY st.created_at DESC
            LIMIT 100
        `, [req.session.shopId]);

        // Get supplier purchase summary
        const [purchaseSummary] = await pool.execute(`
            SELECT 
                s.name as supplier_name,
                COUNT(si.id) as purchase_count,
                SUM(si.quantity * si.buying_price) as total_purchase,
                MAX(si.created_at) as last_purchase
            FROM stock_in si
            JOIN suppliers s ON si.supplier_id = s.id
            WHERE si.shop_id = UUID_TO_BIN(?)
            GROUP BY s.id
            ORDER BY total_purchase DESC
        `, [req.session.shopId]);

        // Calculate summary
        const summary = {
            totalSuppliers: suppliers.length,
            totalBalance: suppliers.reduce((sum, s) => sum + parseFloat(s.balance), 0),
            totalDebit: suppliers.reduce((sum, s) => sum + parseFloat(s.total_debit), 0),
            totalCredit: suppliers.reduce((sum, s) => sum + parseFloat(s.total_credit), 0)
        };

        res.json({
            success: true,
            suppliers: suppliers,
            transactions: transactions,
            purchaseSummary: purchaseSummary,
            summary: summary
        });

    } catch (err) {
        console.error('Error loading suppliers report:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load suppliers report'
        });
    }
});


// GET /reports/employees - Employees report
router.get('/employees', getShopDetails, async (req, res) => {
    try {
        const status = req.query.status || 'all';
        const includeSalary = req.query.includeSalary === 'true';

        let whereClause = 'u.shop_id = UUID_TO_BIN(?)';
        const params = [req.session.shopId];

        if (status !== 'all') {
            whereClause += ' AND u.status = ?';
            params.push(status);
        }

        // Get employees with salary history
        const [employees] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(u.id) as id,
                u.name,
                u.email,
                u.phone,
                r.role_name as role,
                u.salary,
                u.status,
                COUNT(us.id) as salary_months,
                SUM(us.amount) as total_salary_paid,
                COALESCE(SUM(ul.total_balance), 0) as total_loan_balance
            FROM users u
            LEFT JOIN roles r ON u.role_id = r.id
            LEFT JOIN user_salary us ON u.id = us.user_id AND us.status = 'paid'
            LEFT JOIN user_loan ul ON u.id = ul.user_id AND ul.status = 'active'
            WHERE ${whereClause}
            GROUP BY u.id
            ORDER BY u.name
        `, params);

        // Get salary distribution by month
        const [salaryByMonth] = await pool.execute(`
            SELECT 
                us.month,
                COUNT(DISTINCT us.user_id) as employee_count,
                SUM(us.amount) as total_salary,
                SUM(us.bonus) as total_bonus,
                SUM(us.fine) as total_fine,
                SUM(us.net_amount) as net_salary
            FROM user_salary us
            JOIN users u ON us.user_id = u.id
            WHERE u.shop_id = UUID_TO_BIN(?) AND us.status = 'paid'
            GROUP BY us.month
            ORDER BY us.month DESC
            LIMIT 12
        `, [req.session.shopId]);

        // Get loan summary
        const [loanSummary] = await pool.execute(`
            SELECT 
                u.name as employee_name,
                COUNT(ul.id) as active_loans,
                SUM(ul.total_balance) as total_balance,
                SUM(ul.total_paid) as total_paid
            FROM user_loan ul
            JOIN users u ON ul.user_id = u.id
            WHERE u.shop_id = UUID_TO_BIN(?) AND ul.status = 'active'
            GROUP BY u.id
            ORDER BY total_balance DESC
        `, [req.session.shopId]);

        // Get attendance/activity data (you can expand this with actual attendance table)
        const [recentActivities] = await pool.execute(`
            SELECT 
                aa.action_type,
                aa.details,
                DATE(aa.created_at) as activity_date,
                u.name as employee_name
            FROM admin_actions aa
            JOIN users u ON aa.admin_id = u.id
            WHERE aa.shop_id = UUID_TO_BIN(?)
            ORDER BY aa.created_at DESC
            LIMIT 50
        `, [req.session.shopId]);

        res.json({
            success: true,
            employees: employees,
            salaryByMonth: salaryByMonth,
            loanSummary: loanSummary,
            recentActivities: recentActivities,
            summary: {
                totalEmployees: employees.length,
                activeEmployees: employees.filter(e => e.status === 'active').length,
                totalSalary: employees.reduce((sum, e) => sum + (parseFloat(e.salary) || 0), 0),
                totalLoans: loanSummary.reduce((sum, l) => sum + (parseFloat(l.total_balance) || 0), 0)
            }
        });

    } catch (err) {
        console.error('Error loading employees report:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load employees report'
        });
    }
});

// GET /reports/raw-materials - Raw materials report
router.get('/raw-materials', getShopDetails, async (req, res) => {
    try {
        const category = req.query.category || 'all';
        const lowStock = req.query.lowStock === 'true';

        let whereClause = 'rm.shop_id = UUID_TO_BIN(?) AND rm.is_active = TRUE';
        const params = [req.session.shopId];

        if (category !== 'all') {
            whereClause += ' AND rm.category = ?';
            params.push(category);
        }

        if (lowStock) {
            whereClause += ' AND rm.current_stock <= rm.min_stock_level';
        }

        // Get raw materials
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
                (rm.current_stock * rm.cost_price) as stock_value,
                s.name as supplier_name,
                rm.batch_tracking,
                rm.expiry_tracking
            FROM raw_materials rm
            LEFT JOIN suppliers s ON rm.supplier_id = s.id
            WHERE ${whereClause}
            ORDER BY rm.name
        `, params);

        // Get stock movements
        const [stockMovements] = await pool.execute(`
            SELECT 
                rm.name as material_name,
                rmsm.movement_type,
                rmsm.quantity,
                rmsm.unit_cost,
                rmsm.total_cost,
                rmsm.reference_type,
                DATE(rmsm.movement_date) as movement_date,
                rmsm.batch_number,
                rmsm.expiry_date
            FROM raw_material_stock_movements rmsm
            JOIN raw_materials rm ON rmsm.raw_material_id = rm.id
            WHERE rm.shop_id = UUID_TO_BIN(?)
            ORDER BY rmsm.movement_date DESC, rmsm.created_at DESC
            LIMIT 100
        `, [req.session.shopId]);

        // Get categories for filter
        const [categories] = await pool.execute(`
            SELECT DISTINCT category 
            FROM raw_materials 
            WHERE shop_id = UUID_TO_BIN(?) AND category IS NOT NULL
            ORDER BY category
        `, [req.session.shopId]);

        res.json({
            success: true,
            rawMaterials: rawMaterials,
            stockMovements: stockMovements,
            categories: categories.map(c => c.category),
            summary: {
                totalMaterials: rawMaterials.length,
                totalStockValue: rawMaterials.reduce((sum, rm) => sum + (parseFloat(rm.stock_value) || 0), 0),
                lowStockCount: rawMaterials.filter(rm => rm.current_stock <= rm.min_stock_level).length
            }
        });

    } catch (err) {
        console.error('Error loading raw materials report:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load raw materials report'
        });
    }
});

// GET /reports/production - Production/ingredients report
// GET /reports/production - Enhanced Production report
router.get('/production', getShopDetails, async (req, res) => {
    try {
        const fromDate = req.query.fromDate || new Date().toISOString().slice(0, 8) + '01';
        const toDate = req.query.toDate || new Date().toISOString().slice(0, 10);

        // Get products with their ingredients
        const [productsWithIngredients] = await pool.execute(`
            SELECT 
                p.id as product_id,
                p.name as product_name,
                p.sku as product_sku,
                rm.id as ingredient_id,
                rm.name as ingredient_name,
                rm.sku as ingredient_sku,
                i.quantity_required,
                i.unit,
                COALESCE(rm.current_stock, 0) as available_stock,
                COALESCE(rm.cost_price, 0) as cost_price,
                (i.quantity_required * COALESCE(rm.cost_price, 0)) as ingredient_cost_per_unit
            FROM ingredients i
            JOIN products p ON i.main_product_id = p.id
            JOIN raw_materials rm ON i.raw_material_id = rm.id
            WHERE p.shop_id = UUID_TO_BIN(?)
            ORDER BY p.name, rm.name
        `, [req.session.shopId]);

        // Get product sales in the period
        const [productSales] = await pool.execute(`
            SELECT 
                p.id as product_id,
                p.name as product_name,
                SUM(bi.quantity) as total_quantity_sold,
                SUM(bi.total_price) as total_revenue
            FROM bill_items bi
            JOIN products p ON bi.product_id = p.id
            JOIN bills b ON bi.bill_id = b.id
            WHERE b.shop_id = UUID_TO_BIN(?)
            AND DATE(b.created_at) BETWEEN ? AND ?
            GROUP BY p.id
        `, [req.session.shopId, fromDate, toDate]);

        // Get actual raw material consumption (from stock movements)
        const [actualConsumption] = await pool.execute(`
            SELECT 
                rm.id as raw_material_id,
                rm.name as raw_material_name,
                SUM(CASE WHEN rmsm.movement_type = 'out' AND rmsm.reference_type = 'production' THEN rmsm.quantity ELSE 0 END) as actual_used_in_production,
                SUM(CASE WHEN rmsm.movement_type = 'out' THEN rmsm.quantity ELSE 0 END) as total_outgoing,
                SUM(CASE WHEN rmsm.movement_type = 'in' THEN rmsm.quantity ELSE 0 END) as total_incoming
            FROM raw_material_stock_movements rmsm
            JOIN raw_materials rm ON rmsm.raw_material_id = rm.id
            WHERE rm.shop_id = UUID_TO_BIN(?)
            AND rmsm.movement_date BETWEEN ? AND ?
            GROUP BY rm.id
        `, [req.session.shopId, fromDate, toDate]);

        // Calculate expected usage based on sales
        const expectedUsage = [];
        const varianceAnalysis = [];
        const theftDetection = [];

        productsWithIngredients.forEach(product => {
            const sales = productSales.find(s => s.product_id === product.product_id);
            if (sales) {
                const expectedUsed = product.quantity_required * sales.total_quantity_sold;
                const actualUsed = actualConsumption.find(ac => ac.raw_material_id === product.ingredient_id);
                
                const actualUsedAmount = actualUsed ? parseFloat(actualUsed.actual_used_in_production || 0) : 0;
                const variance = expectedUsed - actualUsedAmount;
                const variancePercentage = expectedUsed > 0 ? (variance / expectedUsed) * 100 : 0;
                
                expectedUsage.push({
                    product: product.product_name,
                    ingredient: product.ingredient_name,
                    units_sold: sales.total_quantity_sold,
                    required_per_unit: product.quantity_required,
                    expected_usage: expectedUsed,
                    actual_usage: actualUsedAmount,
                    variance: variance,
                    variance_percentage: variancePercentage,
                    status: Math.abs(variancePercentage) <= 10 ? 'normal' : 
                           variancePercentage > 10 ? 'excess_usage' : 'possible_theft'
                });

                // Variance analysis
                varianceAnalysis.push({
                    ingredient: product.ingredient_name,
                    expected: expectedUsed,
                    actual: actualUsedAmount,
                    variance: variance,
                    variance_percentage: variancePercentage,
                    cost_impact: variance * product.cost_price
                });

                // Theft detection flags
                if (variancePercentage < -20) { // More than 20% less used than expected
                    theftDetection.push({
                        ingredient: product.ingredient_name,
                        product: product.product_name,
                        expected_usage: expectedUsed,
                        actual_usage: actualUsedAmount,
                        missing_amount: Math.abs(variance),
                        estimated_value: Math.abs(variance) * product.cost_price,
                        confidence: 'high'
                    });
                }
            }
        });

        // Calculate summary statistics
        const totalExpectedUsage = expectedUsage.reduce((sum, item) => sum + item.expected_usage, 0);
        const totalActualUsage = expectedUsage.reduce((sum, item) => sum + item.actual_usage, 0);
        const totalVariance = expectedUsage.reduce((sum, item) => sum + item.variance, 0);
        const totalCostImpact = varianceAnalysis.reduce((sum, item) => sum + item.cost_impact, 0);

        // Get raw material movements for the period
        const [ingredientMovements] = await pool.execute(`
            SELECT 
                rm.name as ingredient_name,
                rmsm.movement_type,
                rmsm.reference_type,
                SUM(rmsm.quantity) as total_quantity,
                SUM(rmsm.total_cost) as total_cost,
                COUNT(*) as transaction_count
            FROM raw_material_stock_movements rmsm
            JOIN raw_materials rm ON rmsm.raw_material_id = rm.id
            WHERE rm.shop_id = UUID_TO_BIN(?)
            AND rmsm.movement_date BETWEEN ? AND ?
            GROUP BY rm.name, rmsm.movement_type, rmsm.reference_type
            ORDER BY rm.name, rmsm.movement_type
        `, [req.session.shopId, fromDate, toDate]);

        // Get current stock levels
        const [currentStock] = await pool.execute(`
            SELECT 
                name,
                current_stock,
                min_stock_level,
                max_stock_level,
                (current_stock * cost_price) as stock_value
            FROM raw_materials 
            WHERE shop_id = UUID_TO_BIN(?) AND is_active = TRUE
            ORDER BY name
        `, [req.session.shopId]);

        // Summary
        const summary = {
            totalProducts: [...new Set(productsWithIngredients.map(p => p.product_name))].length,
            totalIngredients: [...new Set(productsWithIngredients.map(p => p.ingredient_name))].length,
            totalProductsSold: productSales.reduce((sum, ps) => sum + parseFloat(ps.total_quantity_sold), 0),
            totalExpectedUsage: totalExpectedUsage,
            totalActualUsage: totalActualUsage,
            totalVariance: totalVariance,
            variancePercentage: totalExpectedUsage > 0 ? (totalVariance / totalExpectedUsage) * 100 : 0,
            totalCostImpact: totalCostImpact,
            possibleTheftCases: theftDetection.length,
            lowStockIngredients: currentStock.filter(cs => cs.current_stock <= cs.min_stock_level).length
        };

        res.json({
            success: true,
            productsWithIngredients: productsWithIngredients,
            productSales: productSales,
            actualConsumption: actualConsumption,
            expectedUsage: expectedUsage,
            varianceAnalysis: varianceAnalysis,
            theftDetection: theftDetection,
            ingredientMovements: ingredientMovements,
            currentStock: currentStock,
            summary: summary,
            period: {
                fromDate: fromDate,
                toDate: toDate
            }
        });

    } catch (err) {
        console.error('Error loading production report:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load production report'
        });
    }
});


// GET /reports/download/:type - Download report as Excel
router.get('/download/:type', getShopDetails, async (req, res) => {
    try {
        const { type } = req.params;
        const { fromDate, toDate, format = 'excel' } = req.query;

        const workbook = new ExcelJS.Workbook();
        let worksheet;

        switch(type) {
            case 'bills':
                worksheet = workbook.addWorksheet('Bills Report');
                // Add bills data
                break;
            case 'products':
                worksheet = workbook.addWorksheet('Products Report');
                // Add products data
                break;
            case 'suppliers':
                worksheet = workbook.addWorksheet('Suppliers Report');
                // Add suppliers data
                break;
            case 'employees':
                worksheet = workbook.addWorksheet('Employees Report');
                // Add employees data
                break;
            case 'raw-materials':
                worksheet = workbook.addWorksheet('Raw Materials Report');
                // Add raw materials data
                break;
            default:
                return res.status(400).json({ success: false, message: 'Invalid report type' });
        }

        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${type}-report-${new Date().toISOString().slice(0,10)}.xlsx`);

        // Write workbook to response
        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Error downloading report:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to download report'
        });
    }
});

// GET /reports/overview - Overview dashboard data
// router.get('/overview', getShopDetails, async (req, res) => {
//     try {
//         const period = req.query.period || 'month'; // day, week, month, year

//         // Revenue trend
//         const [revenueTrend] = await pool.execute(`
//             SELECT 
//                 DATE_FORMAT(created_at, 
//                     CASE ? 
//                         WHEN 'day' THEN '%Y-%m-%d %H:00'
//                         WHEN 'week' THEN '%Y-%m-%d'
//                         WHEN 'month' THEN '%Y-%m-%d'
//                         WHEN 'year' THEN '%Y-%m'
//                     END
//                 ) as period,
//                 SUM(total_amount) as revenue,
//                 COUNT(*) as bill_count
//             FROM bills 
//             WHERE shop_id = UUID_TO_BIN(?)
//             AND created_at >= DATE_SUB(NOW(), INTERVAL 
//                 CASE ?
//                     WHEN 'day' THEN 1 DAY
//                     WHEN 'week' THEN 7 DAY
//                     WHEN 'month' THEN 30 DAY
//                     WHEN 'year' THEN 365 DAY
//                 END
//             )
//             GROUP BY period
//             ORDER BY period
//         `, [period, req.session.shopId, period]);

//         // Top selling products
//         const [topProducts] = await pool.execute(`
//             SELECT 
//                 p.name,
//                 SUM(bi.quantity) as quantity_sold,
//                 SUM(bi.total_price) as revenue
//             FROM bill_items bi
//             JOIN products p ON bi.product_id = p.id
//             JOIN bills b ON bi.bill_id = b.id
//             WHERE b.shop_id = UUID_TO_BIN(?)
//             AND b.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
//             GROUP BY p.id
//             ORDER BY revenue DESC
//             LIMIT 5
//         `, [req.session.shopId]);

//         // Stock alerts
//         const [stockAlerts] = await pool.execute(`
//             SELECT 
//                 p.name,
//                 i.current_quantity,
//                 p.min_stock_level,
//                 CASE 
//                     WHEN i.current_quantity <= p.min_stock_level THEN 'Low'
//                     WHEN i.current_quantity <= p.min_stock_level * 1.5 THEN 'Warning'
//                     ELSE 'Good'
//                 END as status
//             FROM inventory i
//             JOIN products p ON i.product_id = p.id
//             WHERE p.shop_id = UUID_TO_BIN(?)
//             AND i.current_quantity <= p.min_stock_level * 1.5
//             ORDER BY i.current_quantity / p.min_stock_level
//             LIMIT 10
//         `, [req.session.shopId]);

//         // Recent activities
//         const [recentActivities] = await pool.execute(`
//             SELECT 
//                 action_type,
//                 details,
//                 created_at
//             FROM admin_actions 
//             WHERE shop_id = UUID_TO_BIN(?)
//             ORDER BY created_at DESC
//             LIMIT 10
//         `, [req.session.shopId]);

//         res.json({
//             success: true,
//             revenueTrend: revenueTrend,
//             topProducts: topProducts,
//             stockAlerts: stockAlerts,
//             recentActivities: recentActivities
//         });

//     } catch (err) {
//         console.error('Error loading overview:', err);
//         res.status(500).json({
//             success: false,
//             message: 'Failed to load overview data'
//         });
//     }
// });

// GET /reports/overview - Overview dashboard data
// GET /reports/overview - Overview dashboard data
router.get('/overview', getShopDetails, async (req, res) => {
    try {
        const period = req.query.period || 'month';
        const fromDate = req.query.fromDate || new Date().toISOString().slice(0, 8) + '01';
        const toDate = req.query.toDate || new Date().toISOString().slice(0, 10);

        // Determine interval based on period
        let intervalDays;
        let dateFormat;
        
        switch(period) {
            case 'day':
                intervalDays = 1;
                dateFormat = '%Y-%m-%d %H:00';
                break;
            case 'week':
                intervalDays = 7;
                dateFormat = '%Y-%m-%d';
                break;
            case 'month':
                intervalDays = 30;
                dateFormat = '%Y-%m-%d';
                break;
            case 'year':
                intervalDays = 365;
                dateFormat = '%Y-%m';
                break;
            default:
                intervalDays = 30;
                dateFormat = '%Y-%m-%d';
        }

        // Revenue trend - Fixed SQL query
        const [revenueTrend] = await pool.execute(`
            SELECT 
                DATE_FORMAT(created_at, ?) as period,
                SUM(total_amount) as revenue,
                COUNT(*) as bill_count
            FROM bills 
            WHERE shop_id = UUID_TO_BIN(?)
            AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
            GROUP BY period
            ORDER BY period
        `, [dateFormat, req.session.shopId, intervalDays]);

        // Top selling products
        const [topProducts] = await pool.execute(`
            SELECT 
                p.name,
                SUM(bi.total_price) as revenue,
                SUM(bi.quantity) as quantity_sold
            FROM bill_items bi
            JOIN products p ON bi.product_id = p.id
            JOIN bills b ON bi.bill_id = b.id
            WHERE b.shop_id = UUID_TO_BIN(?)
            AND b.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY p.id
            ORDER BY revenue DESC
            LIMIT 10
        `, [req.session.shopId]);

        // Payment methods
        const [paymentMethods] = await pool.execute(`
            SELECT 
                COALESCE(payment_method, 'unknown') as method,
                SUM(total_amount) as totalAmount,
                COUNT(*) as count
            FROM bills 
            WHERE shop_id = UUID_TO_BIN(?)
            AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY payment_method
        `, [req.session.shopId]);

        // Stock alerts - Fixed: products table doesn't have min_stock_level
        const [stockAlerts] = await pool.execute(`
            SELECT 
                p.name,
                COALESCE(i.current_quantity, 0) as current_quantity,
                COALESCE(i.min_stock_level, 10) as min_stock_level,
                CASE 
                    WHEN COALESCE(i.current_quantity, 0) <= 5 THEN 'Low'
                    WHEN COALESCE(i.current_quantity, 0) <= 10 THEN 'Warning'
                    ELSE 'Good'
                END as status
            FROM products p
            LEFT JOIN inventory i ON p.id = i.product_id
            WHERE p.shop_id = UUID_TO_BIN(?)
            AND p.status = 'active'
            AND COALESCE(i.current_quantity, 0) <= 10
            ORDER BY COALESCE(i.current_quantity, 0) ASC
            LIMIT 10
        `, [req.session.shopId]);

        res.json({
            success: true,
            revenueTrend: revenueTrend,
            topProducts: topProducts,
            paymentMethods: paymentMethods,
            stockAlerts: stockAlerts
        });

    } catch (err) {
        console.error('Error loading overview:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load overview data'
        });
    }
});
// GET /reports/download/:type - Enhanced download with ExcelJS
router.get('/download/:type', getShopDetails, async (req, res) => {
    try {
        const { type } = req.params;
        const { fromDate, toDate } = req.query;

        const workbook = new ExcelJS.Workbook();
        workbook.creator = shopData.name;
        workbook.lastModifiedBy = 'Report System';
        workbook.created = new Date();
        workbook.modified = new Date();

        switch(type) {
            case 'bills':
                await generateBillsReport(workbook, req.session.shopId, fromDate, toDate);
                break;
            case 'products':
                await generateProductsReport(workbook, req.session.shopId, fromDate, toDate);
                break;
            case 'suppliers':
                await generateSuppliersReport(workbook, req.session.shopId, fromDate, toDate);
                break;
            case 'employees':
                await generateEmployeesReport(workbook, req.session.shopId, fromDate, toDate);
                break;
            case 'raw-materials':
                await generateRawMaterialsReport(workbook, req.session.shopId, fromDate, toDate);
                break;
            case 'production':
                await generateProductionReport(workbook, req.session.shopId, fromDate, toDate);
                break;
            default:
                return res.status(400).json({ success: false, message: 'Invalid report type' });
        }

        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${type}-report-${new Date().toISOString().slice(0,10)}.xlsx`);

        // Write workbook to response
        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Error downloading report:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to download report'
        });
    }
});

// Helper functions for Excel generation
async function generateBillsReport(workbook, shopId, fromDate, toDate) {
    const worksheet = workbook.addWorksheet('Bills Report');
    
    // Add headers
    worksheet.columns = [
        { header: 'Bill Number', key: 'bill_number', width: 15 },
        { header: 'Customer Name', key: 'customer_name', width: 20 },
        { header: 'Phone', key: 'customer_phone', width: 15 },
        { header: 'Subtotal', key: 'subtotal', width: 15 },
        { header: 'Discount', key: 'discount', width: 12 },
        { header: 'Tax', key: 'tax', width: 12 },
        { header: 'Total Amount', key: 'total_amount', width: 15 },
        { header: 'Paid Amount', key: 'paid_amount', width: 15 },
        { header: 'Due Amount', key: 'due_amount', width: 15 },
        { header: 'Payment Method', key: 'payment_method', width: 15 },
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Created By', key: 'created_by', width: 15 }
    ];

    // Get data
    const [bills] = await pool.execute(`
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
            DATE(b.created_at) as date,
            u.name as created_by
        FROM bills b
        LEFT JOIN users u ON b.created_by = u.id
        WHERE b.shop_id = UUID_TO_BIN(?)
        AND DATE(b.created_at) BETWEEN ? AND ?
        ORDER BY b.created_at DESC
    `, [shopId, fromDate, toDate]);

    // Add rows
    bills.forEach(bill => {
        worksheet.addRow(bill);
    });

    // Add summary
    worksheet.addRow([]);
    const summaryRow = worksheet.addRow([
        'Summary', '', '', '', '', '', 
        `Total: ${bills.reduce((sum, b) => sum + parseFloat(b.total_amount), 0).toFixed(2)}`,
        `Paid: ${bills.reduce((sum, b) => sum + parseFloat(b.paid_amount), 0).toFixed(2)}`,
        `Due: ${bills.reduce((sum, b) => sum + parseFloat(b.due_amount), 0).toFixed(2)}`
    ]);
    summaryRow.font = { bold: true };
}

async function generateProductsReport(workbook, shopId, fromDate, toDate) {
    const worksheet = workbook.addWorksheet('Products Report');
    
    // Similar implementation for products report
    // ... (add your implementation here)
}


module.exports = router;