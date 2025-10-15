const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Middleware to get shop-specific table prefix and details
const getShopPrefix = async (req, res, next) => {
    if (!req.session.shopId) {
        return res.status(403).json({ success: false, message: 'Shop not identified' });
    }

    req.tablePrefix = `shop_${req.session.shopId}_`;

    try {
        const [shops] = await pool.execute(
            'SELECT * FROM shops WHERE id = ?',
            [req.session.shopId]
        );

        req.shop = {
            id: req.session.shopId,
            name: shops[0]?.name || 'My Shop',
            logo: shops[0]?.logo ? `/uploads/${shops[0].logo}` : '/images/default-logo.png',
            currency: shops[0]?.currency || '₹',
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
            currency: 'Pkr',
            primary_color: '#007bff',
            secondary_color: '#6c757d'
        };
        next();
    }
};


// GET /bills?page=1 - Show all bills with pagination and filtering
router.get('/', getShopPrefix, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;

        // Build filter conditions
        let whereConditions = [];
        let queryParams = [];

        // Date filter
        if (req.query.date) {
            let dateCondition = '';
            
            switch (req.query.date) {
                case 'today':
                    dateCondition = 'DATE(b.created_at) = CURDATE()';
                    break;
                case 'yesterday':
                    dateCondition = 'DATE(b.created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)';
                    break;
                case 'week':
                    dateCondition = 'b.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
                    break;
                case 'month':
                    dateCondition = 'b.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
                    break;
            }
            
            if (dateCondition) {
                whereConditions.push(dateCondition);
            }
        }

        // Custom date range
        if (req.query.fromDate && req.query.toDate) {
            whereConditions.push('DATE(b.created_at) BETWEEN ? AND ?');
            queryParams.push(req.query.fromDate, req.query.toDate);
        }

        // Customer filter
        if (req.query.customer) {
            whereConditions.push('(b.customer_name LIKE ? OR b.customer_phone LIKE ?)');
            queryParams.push(`%${req.query.customer}%`, `%${req.query.customer}%`);
        }

        // Bill number filter
        if (req.query.billNumber) {
            whereConditions.push('b.bill_number LIKE ?');
            queryParams.push(`%${req.query.billNumber}%`);
        }

        // Status filter
        if (req.query.status && req.query.status !== 'all') {
            switch (req.query.status) {
                case 'paid':
                    whereConditions.push('b.due_amount = 0 AND b.total_amount >= 0');
                    break;
                case 'pending':
                    whereConditions.push('b.due_amount > 0');
                    break;
                case 'refund':
                    whereConditions.push('b.total_amount < 0');
                    break;
            }
        }

        // Payment method filter
        if (req.query.paymentMethod && req.query.paymentMethod !== 'all') {
            whereConditions.push('b.payment_method = ?');
            queryParams.push(req.query.paymentMethod);
        }

        // Build WHERE clause
        let whereClause = '';
        if (whereConditions.length > 0) {
            whereClause = 'WHERE ' + whereConditions.join(' AND ');
        }

        console.log('Where Clause:', whereClause);
        console.log('Query Params:', queryParams);

        // Get filtered bills with item counts
        const [bills] = await pool.execute(`
            SELECT b.*, COUNT(bi.id) as item_count 
            FROM ${req.tablePrefix}bills b
            LEFT JOIN ${req.tablePrefix}bill_items bi ON b.id = bi.bill_id
            ${whereClause}
            GROUP BY b.id
            ORDER BY b.created_at DESC
            LIMIT ? OFFSET ?
        `, [...queryParams, limit, offset]);

        // Convert string amounts to numbers
        const processedBills = bills.map(bill => ({
            ...bill,
            total_amount: parseFloat(bill.total_amount) || 0,
            paid_amount: parseFloat(bill.paid_amount) || 0,
            due_amount: parseFloat(bill.due_amount) || 0,
            subtotal: parseFloat(bill.subtotal) || 0,
            tax: parseFloat(bill.tax) || 0
        }));

        // Get total count for pagination
        const [[{ total }]] = await pool.execute(`
            SELECT COUNT(DISTINCT b.id) as total 
            FROM ${req.tablePrefix}bills b
            ${whereClause}
        `, queryParams);

        // Get stats - convert to numbers
        const [[stats]] = await pool.execute(`
            SELECT 
                COUNT(*) as totalBills,
                COALESCE(SUM(CASE WHEN due_amount = 0 AND total_amount >= 0 THEN total_amount ELSE 0 END), 0) as totalAmount,
                COALESCE(SUM(CASE WHEN due_amount > 0 THEN due_amount ELSE 0 END), 0) as pendingAmount,
                COUNT(CASE WHEN DATE(created_at) = CURDATE() THEN 1 END) as todayBills
            FROM ${req.tablePrefix}bills
            ${whereClause}
        `, queryParams);

        const totalStats = {
            totalBills: parseInt(stats.totalBills) || 0,
            totalAmount: parseFloat(stats.totalAmount) || 0,
            pendingAmount: parseFloat(stats.pendingAmount) || 0,
            todayBills: parseInt(stats.todayBills) || 0
        };

        const totalPages = Math.ceil(total / limit);

        res.render('bills/all', {
            title: 'All Bills',
            bills: processedBills,
            currentPage: page,
            totalPages: totalPages,
            totalStats: totalStats,
            shop: req.shop,
            query: req.query // Pass query params to pre-fill filters
        });
    } catch (err) {
        console.error('Error fetching bills:', err);
        res.status(500).render('error', {
            message: 'Failed to load bills',
            shop: req.shop
        });
    }
});

// GET /bills/:id - Get single bill details
router.get('/:id', getShopPrefix, async (req, res) => {
    try {
        const billId = req.params.id;

        const [[bill]] = await pool.execute(`
            SELECT * FROM ${req.tablePrefix}bills WHERE id = ?
        `, [billId]);

        const [items] = await pool.execute(`
            SELECT * FROM ${req.tablePrefix}bill_items WHERE bill_id = ?
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

// DELETE /bills/:id - Delete a bill
router.delete('/:id', getShopPrefix, async (req, res) => {
    let connection;
    try {
        const billId = req.params.id;

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // First, update product stocks (reverse the transactions)
        const [billItems] = await connection.execute(`
            SELECT * FROM ${req.tablePrefix}bill_items WHERE bill_id = ?
        `, [billId]);

        for (const item of billItems) {
            if (item.item_type === 'sale') {
                // Return sold items to stock
                await connection.execute(`
                    UPDATE ${req.tablePrefix}products 
                    SET quantity = quantity + ? 
                    WHERE id = ?
                `, [item.quantity, item.product_id]);
            } else if (item.item_type === 'return') {
                // Remove returned items from stock
                await connection.execute(`
                    UPDATE ${req.tablePrefix}products 
                    SET quantity = quantity - ? 
                    WHERE id = ?
                `, [item.quantity, item.product_id]);
            }
        }

        // Delete bill items
        await connection.execute(`
            DELETE FROM ${req.tablePrefix}bill_items WHERE bill_id = ?
        `, [billId]);

        // Delete bill
        await connection.execute(`
            DELETE FROM ${req.tablePrefix}bills WHERE id = ?
        `, [billId]);

        await connection.commit();

        res.json({
            success: true,
            message: 'Bill deleted successfully'
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error deleting bill:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to delete bill'
        });
    } finally {
        if (connection) connection.release();
    }
});

// GET /bills/:id/print - Print bill
router.get('/:id/print', getShopPrefix, async (req, res) => {
    try {
        const billId = req.params.id;

        const [[bill]] = await pool.execute(`
            SELECT * FROM ${req.tablePrefix}bills WHERE id = ?
        `, [billId]);

        const [items] = await pool.execute(`
            SELECT * FROM ${req.tablePrefix}bill_items WHERE bill_id = ?
        `, [billId]);

        res.render('bills/print', {
            bill: bill,
            items: items,
            shop: req.shop
        });
    } catch (err) {
        console.error('Error generating print view:', err);
        res.status(500).send('Error generating print view');
    }
});

// GET /bills/export - Export bills to CSV/Excel
router.get('/export', getShopPrefix, async (req, res) => {
    try {
        // Similar filtering logic as the main bills route
        // Export implementation would go here
        res.json({ message: 'Export functionality to be implemented' });
    } catch (err) {
        console.error('Error exporting bills:', err);
        res.status(500).json({ success: false, message: 'Export failed' });
    }
});


module.exports = router;
