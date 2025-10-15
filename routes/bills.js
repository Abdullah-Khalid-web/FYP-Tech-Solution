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
            currency: '₹',
            primary_color: '#007bff',
            secondary_color: '#6c757d'
        };
        next();
    }
};

// GET /bills - Render bills page with products
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

        // Get products with stock information
        const [products] = await pool.execute(`
            SELECT id, name, sku, selling_price, quantity, brand 
            FROM ${req.tablePrefix}products 
            WHERE quantity > 0 
            ORDER BY name
        `);

        res.render('bills/index', {
            title: 'Sales & Returns',
            recentBills: bills,
            products: products,
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
    console.log('Received bill creation request:', {
        body: req.body,
        tablePrefix: req.tablePrefix,
        userId: req.session.userId
    });

    const userId = req.session.userId;
    const { customer_name, customer_phone, payment_method, paid_amount, notes, items, tax_amount } = req.body;

    // Validate required fields
    if (!items || !Array.isArray(items) || items.length === 0) {
        console.error('No items in transaction');
        return res.status(400).json({
            success: false,
            message: 'No items in transaction'
        });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        console.log('Transaction started, validating products and stock...');

        // Get all product IDs to validate they exist - FIXED: Use productId instead of id
        const productIds = items.map(item => item.productId).filter(id => id && typeof id === 'number');
        console.log('Product IDs in transaction:', productIds);

        if (productIds.length === 0) {
            throw new Error('No valid product IDs found in transaction items');
        }

        // Get all products at once for validation
        const placeholders = productIds.map(() => '?').join(',');
        const [products] = await connection.execute(
            `SELECT id, name, quantity, selling_price FROM ${req.tablePrefix}products WHERE id IN (${placeholders})`,
            productIds
        );

        console.log('Found products in database:', products);

        // Create a map for easy lookup
        const productMap = new Map();
        products.forEach(product => {
            productMap.set(product.id, product);
        });

        // Validate all items exist and have sufficient stock
        const saleItems = items.filter(item => item.type === 'sale');
        for (const item of saleItems) {
            const product = productMap.get(item.productId);

            if (!product) {
                throw new Error(`Product not found: "${item.name}" (ID: ${item.productId}). The product may have been deleted.`);
            }

            if (product.quantity < item.quantity) {
                throw new Error(`Insufficient stock for ${item.name}. Available: ${product.quantity}, Requested: ${item.quantity}`);
            }
            console.log(`Stock validation passed for ${item.name}: ${product.quantity} available`);
        }

        // Calculate totals - FIXED: Use correct product prices
        const salesSubtotal = saleItems.reduce((sum, item) => {
            const product = productMap.get(item.productId);
            const price = product ? product.selling_price : item.price;
            return sum + (price * item.quantity);
        }, 0);

        const returnItems = items.filter(item => item.type === 'return');
        const returnsSubtotal = returnItems.reduce((sum, item) => {
            const product = productMap.get(item.productId);
            const price = product ? product.selling_price : item.price;
            return sum + (price * item.quantity);
        }, 0);

        const totalDiscount = items.reduce((sum, item) => sum + (item.discount || 0), 0);
        const tax = tax_amount ? parseFloat(tax_amount) : 1.00;
        const total = salesSubtotal - returnsSubtotal - totalDiscount + tax;
        const due = total - (parseFloat(paid_amount) || 0);

        console.log('Calculated totals:', {
            salesSubtotal,
            returnsSubtotal,
            totalDiscount,
            tax,
            total,
            due
        });

        // Generate bill number
        const billNumber = 'INV-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000);

        // Insert bill
        const [billResult] = await connection.execute(`
            INSERT INTO ${req.tablePrefix}bills 
            (bill_number, customer_name, customer_phone, subtotal, tax, total_amount, 
             paid_amount, due_amount, payment_method, notes, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            billNumber,
            customer_name || 'Walk-in Customer',
            customer_phone || '',
            salesSubtotal - returnsSubtotal,
            tax,
            total,
            paid_amount || 0,
            due,
            payment_method || 'cash',
            notes || '',
            userId
        ]);

        const billId = billResult.insertId;
        console.log('Bill created with ID:', billId);

        // Insert bill items - FIXED: Use productId instead of id
        for (const item of items) {
            const product = productMap.get(item.productId);
            const unitPrice = product ? product.selling_price : item.price;
            const itemTotal = (unitPrice * item.quantity) - (item.discount || 0);
            const itemTax = (unitPrice * item.quantity) * 0.1;

            await connection.execute(`
                INSERT INTO ${req.tablePrefix}bill_items
                (bill_id, product_id, product_name, quantity, unit_price, discount, 
                 tax_amount, total_price, item_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                billId,
                item.productId,
                item.name,
                item.quantity,
                unitPrice,
                item.discount || 0,
                itemTax,
                itemTotal,
                item.type
            ]);

            console.log(`Inserted bill item: ${item.name} (Database ID: ${item.productId}, Type: ${item.type})`);

            // Update product stock - FIXED: Use productId instead of id
            if (item.type === 'sale') {
                await connection.execute(`
                    UPDATE ${req.tablePrefix}products 
                    SET quantity = quantity - ? 
                    WHERE id = ?
                `, [item.quantity, item.productId]);
                console.log(`Updated stock for sale: ${item.name} -${item.quantity}`);
            } else if (item.type === 'return') {
                await connection.execute(`
                    UPDATE ${req.tablePrefix}products 
                    SET quantity = quantity + ? 
                    WHERE id = ?
                `, [item.quantity, item.productId]);
                console.log(`Updated stock for return: ${item.name} +${item.quantity}`);
            }
        }

        await connection.commit();
        console.log('Transaction committed successfully');

        // Get the complete bill details for response
        const [[billDetails]] = await connection.execute(
            `SELECT * FROM ${req.tablePrefix}bills WHERE id = ?`,
            [billId]
        );

        const [billItems] = await connection.execute(
            `SELECT * FROM ${req.tablePrefix}bill_items WHERE bill_id = ?`,
            [billId]
        );

        // After successful transaction commit, before sending response:
        res.json({
            success: true,
            billId: billId,
            billNumber: billNumber,
            total: total,
            currency: req.shop.currency,
            billDetails: {
                bill_number: billNumber,
                customer_name: customer_name || 'Walk-in Customer',
                customer_phone: customer_phone || '',
                subtotal: salesSubtotal - returnsSubtotal,
                tax: tax,
                total_amount: total,
                paid_amount: paid_amount || 0,
                due_amount: due,
                payment_method: payment_method || 'cash',
                notes: notes || '',
                created_at: new Date()
            },
            billItems: items.map(item => {
                const product = productMap.get(item.productId);
                const unitPrice = product ? product.selling_price : item.price;
                return {
                    product_name: item.name,
                    quantity: item.quantity,
                    unit_price: unitPrice,
                    discount: item.discount || 0,
                    total_price: (unitPrice * item.quantity) - (item.discount || 0),
                    item_type: item.type
                };
            }),
            message: 'Transaction completed successfully'
        });
    } catch (err) {
        if (connection) {
            await connection.rollback();
            console.error('Transaction rolled back due to error:', err);
        }

        console.error('Error creating bill:', err);

        res.status(500).json({
            success: false,
            message: err.message
        });
    } finally {
        if (connection) {
            connection.release();
            console.log('Database connection released');
        }
    }
});

// GET /bills/search - Search bills by customer or bill number
router.get('/search', getShopPrefix, async (req, res) => {
    try {
        const { query, type } = req.query;

        if (!query) {
            return res.json({ success: true, bills: [] });
        }

        let searchQuery = '';
        let params = [];

        if (type === 'customer') {
            searchQuery = `
                SELECT b.*, COUNT(bi.id) as item_count 
                FROM ${req.tablePrefix}bills b
                LEFT JOIN ${req.tablePrefix}bill_items bi ON b.id = bi.bill_id
                WHERE b.customer_name LIKE ? OR b.customer_phone LIKE ?
                GROUP BY b.id
                ORDER BY b.created_at DESC
                LIMIT 10
            `;
            params = [`%${query}%`, `%${query}%`];
        } else if (type === 'bill') {
            searchQuery = `
                SELECT b.*, COUNT(bi.id) as item_count 
                FROM ${req.tablePrefix}bills b
                LEFT JOIN ${req.tablePrefix}bill_items bi ON b.id = bi.bill_id
                WHERE b.bill_number LIKE ?
                GROUP BY b.id
                ORDER BY b.created_at DESC
                LIMIT 10
            `;
            params = [`%${query}%`];
        }

        const [bills] = await pool.execute(searchQuery, params);

        res.json({ success: true, bills });
    } catch (err) {
        console.error('Error searching bills:', err);
        res.status(500).json({ success: false, message: 'Failed to search bills' });
    }
});

// GET /bills/:id/items - Get bill items for return
router.get('/:id/items', getShopPrefix, async (req, res) => {
    try {
        const billId = req.params.id;

        const [items] = await pool.execute(`
            SELECT bi.*, p.sku, p.quantity as current_stock, p.brand
            FROM ${req.tablePrefix}bill_items bi
            LEFT JOIN ${req.tablePrefix}products p ON bi.product_id = p.id
            WHERE bi.bill_id = ? AND bi.item_type = 'sale'
        `, [billId]);

        const [[bill]] = await pool.execute(`
            SELECT * FROM ${req.tablePrefix}bills WHERE id = ?
        `, [billId]);

        res.json({
            success: true,
            bill: {
                ...bill,
                items: items
            }
        });
    } catch (err) {
        console.error('Error fetching bill items:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load bill items'
        });
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
            message: 'Failed to load bill details'
        });
    }
});

// GET /bills/api/products - API endpoint for product search
router.get('/api/products', getShopPrefix, async (req, res) => {
    try {
        const { search } = req.query;
        let query = `
            SELECT id, name, sku, selling_price as price, quantity as stock, brand
            FROM ${req.tablePrefix}products 
            WHERE quantity > 0
        `;
        let params = [];

        if (search && search.length > 0) {
            query += ' AND (name LIKE ? OR sku LIKE ? OR brand LIKE ?)';
            params = [`%${search}%`, `%${search}%`, `%${search}%`];
        }

        query += ' ORDER BY name LIMIT 20';

        const [products] = await pool.execute(query, params);

        res.json({ success: true, products });
    } catch (err) {
        console.error('Error fetching products:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch products' });
    }
});

// GET /bills/api/customer-bills - Get customer's previous bills
router.get('/api/customer-bills', getShopPrefix, async (req, res) => {
    try {
        const { phone, name, search } = req.query;

        if (!phone && !name && !search) {
            return res.json({ success: true, bills: [] });
        }

        let query = `
            SELECT b.*, COUNT(bi.id) as item_count 
            FROM ${req.tablePrefix}bills b
            LEFT JOIN ${req.tablePrefix}bill_items bi ON b.id = bi.bill_id
            WHERE 1=1
        `;
        let params = [];

        if (phone) {
            query += ' AND b.customer_phone LIKE ?';
            params.push(`%${phone}%`);
        }

        if (name) {
            query += ' AND b.customer_name LIKE ?';
            params.push(`%${name}%`);
        }

        if (search) {
            query += ' AND (b.customer_name LIKE ? OR b.customer_phone LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        query += ' GROUP BY b.id ORDER BY b.created_at DESC LIMIT 10';

        const [bills] = await pool.execute(query, params);

        res.json({ success: true, bills });
    } catch (err) {
        console.error('Error fetching customer bills:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch customer bills' });
    }
});

// GET /bills/api/debug-stock - Debug stock information
router.get('/api/debug-stock', getShopPrefix, async (req, res) => {
    try {
        const [products] = await pool.execute(`
            SELECT id, name, sku, quantity as stock, selling_price 
            FROM ${req.tablePrefix}products 
            ORDER BY name
        `);

        res.json({
            success: true,
            products,
            tablePrefix: req.tablePrefix
        });
    } catch (err) {
        console.error('Error fetching stock debug info:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch stock info' });
    }
});


module.exports = router;