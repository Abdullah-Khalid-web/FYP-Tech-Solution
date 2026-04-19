const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Helper functions for UUID handling
const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

const uuidToBin = (uuid) => {
    return Buffer.from(uuid.replace(/-/g, ''), 'hex');
};

const binToUuid = (buffer) => {
    const hex = buffer.toString('hex');
    return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}`;
};

// Helper function to build query string (add this at the top of your controller)
const buildQueryString = (params) => {
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '' && value !== 'all') {
            queryParams.append(key, value);
        }
    }
    return queryParams.toString();
};



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

        if (shops.length === 0) {
            return res.status(404).json({ success: false, message: 'Shop not found' });
        }

        req.shop = {
            id: req.session.shopId,
            name: shops[0].name || 'My Shop',
            logo: shops[0].logo ? `/uploads/${shops[0].logo}` : '/images/default-logo.png',
            currency: shops[0].currency || '₹',
            primary_color: shops[0].primary_color || '#007bff',
            secondary_color: shops[0].secondary_color || '#6c757d'
        };

        next();
    } catch (err) {
        console.error('Error fetching shop details:', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// GET /ALLbills?page=1 - Show all bills with pagination and filtering
router.get('/', getShopDetails, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        const shopBinaryId = uuidToBin(req.shop.id);

        // Build filter conditions
        let whereConditions = ['b.shop_id = ?'];
        let queryParams = [shopBinaryId];

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
        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        console.log('Where Clause:', whereClause);
        console.log('Query Params:', queryParams);

        // Get filtered bills with item counts
        const [bills] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(b.id) as id_str,
                b.bill_number,
                b.customer_name,
                b.customer_phone,
                b.subtotal,
                b.tax,
                b.total_amount,
                b.paid_amount,
                b.due_amount,
                b.payment_method,
                b.notes,
                b.created_at,
                COUNT(bi.id) as item_count
            FROM bills b
            LEFT JOIN bill_items bi ON b.id = bi.bill_id
            ${whereClause}
            GROUP BY b.id
            ORDER BY b.created_at DESC
            LIMIT ? OFFSET ?
        `, [...queryParams, limit, offset]);

        // Convert amounts to numbers
        const processedBills = bills.map(bill => ({
            id: bill.id_str, // Use the UUID string
            bill_number: bill.bill_number,
            customer_name: bill.customer_name,
            customer_phone: bill.customer_phone,
            total_amount: parseFloat(bill.total_amount) || 0,
            paid_amount: parseFloat(bill.paid_amount) || 0,
            due_amount: parseFloat(bill.due_amount) || 0,
            subtotal: parseFloat(bill.subtotal) || 0,
            tax: parseFloat(bill.tax) || 0,
            payment_method: bill.payment_method,
            notes: bill.notes,
            created_at: bill.created_at,
            item_count: parseInt(bill.item_count) || 0
        }));

        // Get total count for pagination
        const [[{ total }]] = await pool.execute(`
            SELECT COUNT(DISTINCT b.id) as total 
            FROM bills b
            ${whereClause}
        `, queryParams);

        // Get stats - FIXED: Use correct table alias
        const [[stats]] = await pool.execute(`
            SELECT 
                COUNT(*) as totalBills,
                COALESCE(SUM(CASE WHEN b.due_amount = 0 AND b.total_amount >= 0 THEN b.total_amount ELSE 0 END), 0) as totalAmount,
                COALESCE(SUM(CASE WHEN b.due_amount > 0 THEN b.due_amount ELSE 0 END), 0) as pendingAmount,
                COUNT(CASE WHEN DATE(b.created_at) = CURDATE() THEN 1 END) as todayBills
            FROM bills b
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
            query: req.query
        });
    } catch (err) {
        console.error('Error fetching bills:', err);
        res.status(500).render('error', {
            message: 'Failed to load bills',
            shop: req.shop
        });
    }
});

// GET /ALLbills/:id - Get single bill details
router.get('/:id', getShopDetails, async (req, res) => {
    try {
        const billId = uuidToBin(req.params.id);
        const shopBinaryId = uuidToBin(req.shop.id);

        const [[bill]] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(id) as id_str,
                bill_number,
                customer_name,
                customer_phone,
                subtotal,
                tax,
                total_amount,
                paid_amount,
                due_amount,
                payment_method,
                notes,
                created_at
            FROM bills 
            WHERE id = ? 
            AND shop_id = ?
        `, [billId, shopBinaryId]);

        const [items] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(product_id) as product_id_str,
                product_name,
                quantity,
                unit_price,
                total_price,
                item_type
            FROM bill_items 
            WHERE bill_id = ? 
            AND shop_id = ?
        `, [billId, shopBinaryId]);

        res.json({
            success: true,
            bill: {
                ...bill,
                currency: req.shop.currency
            },
            items: items.map(item => ({
                ...item,
                currency: req.shop.currency
            }))
        });
    } catch (err) {
        console.error('Error fetching bill details:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load bill details'
        });
    }
});

// DELETE /ALLbills/:id - Delete a bill
router.delete('/:id', getShopDetails, async (req, res) => {
    let connection;
    try {
        const billId = uuidToBin(req.params.id);
        const shopBinaryId = uuidToBin(req.shop.id);

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // First, get bill items and update inventory
        const [billItems] = await connection.execute(`
            SELECT 
                bi.product_id,
                bi.quantity,
                bi.item_type
            FROM bill_items bi
            WHERE bi.bill_id = ? 
            AND bi.shop_id = ?
        `, [billId, shopBinaryId]);

        for (const item of billItems) {
            if (item.item_type === 'sale') {
                // Return sold items to stock
                await connection.execute(`
                    UPDATE inventory 
                    SET current_quantity = current_quantity + ?,
                        updated_at = NOW()
                    WHERE product_id = ?
                    AND shop_id = ?
                `, [item.quantity, item.product_id, shopBinaryId]);
            } else if (item.item_type === 'return') {
                // Remove returned items from stock
                await connection.execute(`
                    UPDATE inventory 
                    SET current_quantity = current_quantity - ?,
                        updated_at = NOW()
                    WHERE product_id = ?
                    AND shop_id = ?
                `, [item.quantity, item.product_id, shopBinaryId]);
            }
        }

        // Delete bill items
        await connection.execute(`
            DELETE FROM bill_items 
            WHERE bill_id = ? 
            AND shop_id = ?
        `, [billId, shopBinaryId]);

        // Delete bill
        await connection.execute(`
            DELETE FROM bills 
            WHERE id = ? 
            AND shop_id = ?
        `, [billId, shopBinaryId]);

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

// GET /ALLbills/:id/print - Print bill
router.get('/:id/print', getShopDetails, async (req, res) => {
    try {
        const billId = uuidToBin(req.params.id);
        const shopBinaryId = uuidToBin(req.shop.id);

        const [[bill]] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(id) as id_str,
                bill_number,
                customer_name,
                customer_phone,
                subtotal,
                tax,
                total_amount,
                paid_amount,
                due_amount,
                payment_method,
                notes,
                created_at
            FROM bills 
            WHERE id = ? 
            AND shop_id = ?
        `, [billId, shopBinaryId]);

        const [items] = await pool.execute(`
            SELECT 
                product_name,
                quantity,
                unit_price,
                total_price,
                item_type
            FROM bill_items 
            WHERE bill_id = ? 
            AND shop_id = ?
        `, [billId, shopBinaryId]);

        res.render('bills/print', {
            bill: {
                ...bill,
                currency: req.shop.currency
            },
            items: items,
            shop: req.shop
        });
    } catch (err) {
        console.error('Error generating print view:', err);
        res.status(500).send('Error generating print view');
    }
});

// GET /ALLbills/export - Export bills to CSV/Excel
router.get('/export', getShopDetails, async (req, res) => {
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