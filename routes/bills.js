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
        // Get shop details from database
        const [shops] = await pool.execute(
            'SELECT * FROM shops WHERE id = ?',
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

// GET /bills - List all bills
router.get('/', getShopPrefix, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;

        // Get bills with item counts
        const [bills] = await pool.execute(`
            SELECT b.*, COUNT(bi.id) as item_count 
            FROM ${req.tablePrefix}bills b
            LEFT JOIN ${req.tablePrefix}bill_items bi ON b.id = bi.bill_id
            GROUP BY b.id
            ORDER BY b.created_at DESC
            LIMIT ? OFFSET ?
        `, [limit, offset]);

        // Get total count for pagination
        const [[{ total }]] = await pool.execute(`
            SELECT COUNT(*) as total FROM ${req.tablePrefix}bills
        `);

        const totalPages = Math.ceil(total / limit);

        res.render('bills/index', {
            title: 'Bills',
            recentBills: bills,  // Changed from bills to recentBills
            currentPage: page,
            totalPages,
            shop: req.shop
        });
    } catch (err) {
        console.error('Error fetching bills:', err);
        res.status(500).render('error', { 
            message: 'Failed to load bills',
            shop: req.shop
        });
    }
});

// POST /bills - Create new bill
router.post('/', getShopPrefix, async (req, res) => {
    const userId = req.session.userId;
    const { customer_name, customer_phone, payment_method, paid_amount, items } = req.body;

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Calculate totals
        const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity - item.discount), 0);
        const tax = subtotal * 0.0; // Adjust tax rate as needed
        const total = subtotal + tax;
        const due = total - paid_amount;

        // Generate bill number
        const billNumber = 'INV-' + Date.now().toString().slice(-6);

        // Insert bill
        const [billResult] = await connection.execute(`
            INSERT INTO ${req.tablePrefix}bills 
            (bill_number, customer_name, customer_phone, subtotal, tax, total_amount, paid_amount, due_amount, payment_method, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [billNumber, customer_name, customer_phone, subtotal, tax, total, paid_amount, due, payment_method, userId]);

        const billId = billResult.insertId;

        // Insert bill items
        for (const item of items) {
            await connection.execute(`
                INSERT INTO ${req.tablePrefix}bill_items
                (bill_id, product_id, product_name, quantity, unit_price, discount, total_price)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                billId,
                item.id,
                item.name,
                item.quantity,
                item.price,
                item.discount,
                (item.price * item.quantity) - item.discount
            ]);

            // Update product stock
            await connection.execute(`
                UPDATE ${req.tablePrefix}products 
                SET quantity = quantity - ? 
                WHERE id = ?
            `, [item.quantity, item.id]);
        }

        await connection.commit();
        res.json({ 
            success: true, 
            billId,
            billNumber,
            total,
            currency: req.shop.currency
        });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error creating bill:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to create bill',
            shop: req.shop
        });
    } finally {
        if (connection) connection.release();
    }
});

// GET /bills/:id - Get bill details
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
            bill, 
            items,
            shop: {
                currency: req.shop.currency,
                logo: req.shop.logo,
                name: req.shop.name
            }
        });
    } catch (err) {
        console.error('Error fetching bill details:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to load bill details',
            shop: req.shop
        });
    }
});

// DELETE /bills/:id - Delete bill
router.delete('/:id', getShopPrefix, async (req, res) => {
    const billId = req.params.id;

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // First delete items to maintain referential integrity
        await connection.execute(`
            DELETE FROM ${req.tablePrefix}bill_items WHERE bill_id = ?
        `, [billId]);

        // Then delete the bill
        await connection.execute(`
            DELETE FROM ${req.tablePrefix}bills WHERE id = ?
        `, [billId]);

        await connection.commit();
        res.json({ success: true });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error deleting bill:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to delete bill',
            shop: req.shop
        });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;