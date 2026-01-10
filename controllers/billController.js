const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Helper function to generate UUID
const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

// Convert UUID to binary for MySQL
const uuidToBin = (uuid) => {
    return Buffer.from(uuid.replace(/-/g, ''), 'hex');
};

// Convert binary UUID to string
const binToUuid = (buffer) => {
    const hex = buffer.toString('hex');
    return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}`;
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

        // Store shop binary ID for database queries
        req.shopBinaryId = uuidToBin(req.session.shopId);
        
        next();
    } catch (err) {
        console.error('Error fetching shop details:', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// GET /bills - Render bills page with products
router.get('/', getShopDetails, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;

        // Get bills with item counts
        const [bills] = await pool.execute(`
            SELECT b.*, 
                   COUNT(bi.id) as item_count,
                   BIN_TO_UUID(b.id) as bill_id_str,
                   BIN_TO_UUID(b.shop_id) as shop_id_str,
                   BIN_TO_UUID(b.created_by) as created_by_str
            FROM bills b
            LEFT JOIN bill_items bi ON b.id = bi.bill_id
            WHERE b.shop_id = UUID_TO_BIN(?)
            GROUP BY b.id
            ORDER BY b.created_at DESC
            LIMIT ? OFFSET ?
        `, [req.shop.id, limit, offset]);

        // Get total count for pagination
        const [[{ total }]] = await pool.execute(`
            SELECT COUNT(*) as total FROM bills 
            WHERE shop_id = UUID_TO_BIN(?)
        `, [req.shop.id]);

        const totalPages = Math.ceil(total / limit);

        // Get products with stock information
        const [products] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(p.id) as id,
                p.name,
                p.sku,
                COALESCE(i.selling_price, 0) as selling_price,
                COALESCE(i.current_quantity, 0) as quantity,
                p.brand,
                p.status
            FROM products p
            LEFT JOIN inventory i ON p.id = i.product_id
            WHERE p.shop_id = UUID_TO_BIN(?)
            AND COALESCE(i.current_quantity, 0) > 0
            AND p.status = 'active'
            ORDER BY p.name
        `, [req.shop.id]);

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
// POST /bills - Create new bill
router.post('/', getShopDetails, async (req, res) => {
    console.log('Received bill creation request:', {
        body: req.body,
        shopId: req.shop.id,
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
        console.log('Items received:', JSON.stringify(items, null, 2));

        // Filter valid product IDs (UUID strings)
        const productIds = items
            .map(item => item.productId)
            .filter(id => id && typeof id === 'string' && id.length === 36); // UUID validation

        console.log('Valid product IDs:', productIds);

        if (productIds.length === 0) {
            throw new Error('No valid product IDs found in transaction items. Please ensure products are selected correctly.');
        }

        // Convert UUID strings to binary
        const productBinaryIds = productIds.map(id => uuidToBin(id));

        // Get all products at once for validation
        const placeholders = productBinaryIds.map(() => '?').join(',');
        const [products] = await connection.execute(`
            SELECT 
                BIN_TO_UUID(p.id) as id_str,
                p.id,
                p.name,
                COALESCE(i.current_quantity, 0) as quantity,
                COALESCE(i.selling_price, 0) as selling_price
            FROM products p
            LEFT JOIN inventory i ON p.id = i.product_id
            WHERE p.id IN (${placeholders})
            AND p.shop_id = UUID_TO_BIN(?)
            AND p.status = 'active'
        `, [...productBinaryIds, req.shop.id]);

        console.log('Found products in database:', products);

        if (products.length === 0) {
            throw new Error('No valid products found in database. Please check product selection.');
        }

        // Create a map for easy lookup
        const productMap = new Map();
        products.forEach(product => {
            productMap.set(product.id_str, {
                id: product.id,
                name: product.name,
                quantity: product.quantity,
                selling_price: product.selling_price
            });
        });

        // Validate all items exist and have sufficient stock
        const saleItems = items.filter(item => item.type === 'sale');
        for (const item of saleItems) {
            const product = productMap.get(item.productId);

            if (!product) {
                throw new Error(`Product not found: "${item.name}" (ID: ${item.productId}). The product may have been deleted or is inactive.`);
            }

            if (product.quantity < item.quantity) {
                throw new Error(`Insufficient stock for ${item.name}. Available: ${product.quantity}, Requested: ${item.quantity}`);
            }
            console.log(`Stock validation passed for ${item.name}: ${product.quantity} available`);
        }

        // Calculate totals
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
        const billId = uuidToBin(generateUUID());
        const shopBinaryId = uuidToBin(req.shop.id);
        const userBinaryId = userId ? uuidToBin(userId) : null;

        // Insert bill
        await connection.execute(`
            INSERT INTO bills 
            (id, shop_id, bill_number, customer_name, customer_phone, 
             subtotal, tax, total_amount, paid_amount, due_amount, 
             payment_method, notes, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
            billId,
            shopBinaryId,
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
            userBinaryId
        ]);

        console.log('Bill created with ID:', binToUuid(billId));

        // Insert bill items and update inventory
        for (const item of items) {
            const product = productMap.get(item.productId);
            const unitPrice = product ? product.selling_price : item.price;
            const itemTotal = (unitPrice * item.quantity) - (item.discount || 0);
            const itemTax = (unitPrice * item.quantity) * 0.1;
            
            const billItemId = uuidToBin(generateUUID());
            const productBinaryId = uuidToBin(item.productId);

            // Insert bill item
            await connection.execute(`
                INSERT INTO bill_items
                (id, shop_id, bill_id, product_id, quantity, unit_price, total_price, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
            `, [
                billItemId,
                shopBinaryId,
                billId,
                productBinaryId,
                item.quantity,
                unitPrice,
                itemTotal
            ]);

            console.log(`Inserted bill item: ${item.name} (Database ID: ${item.productId}, Type: ${item.type})`);

            // Update inventory
            if (item.type === 'sale') {
                await connection.execute(`
                    UPDATE inventory 
                    SET current_quantity = current_quantity - ?,
                        updated_at = NOW()
                    WHERE product_id = ?
                    AND shop_id = UUID_TO_BIN(?)
                `, [item.quantity, productBinaryId, req.shop.id]);
                console.log(`Updated stock for sale: ${item.name} -${item.quantity}`);
            } else if (item.type === 'return') {
                await connection.execute(`
                    UPDATE inventory 
                    SET current_quantity = current_quantity + ?,
                        updated_at = NOW()
                    WHERE product_id = ?
                    AND shop_id = UUID_TO_BIN(?)
                `, [item.quantity, productBinaryId, req.shop.id]);
                console.log(`Updated stock for return: ${item.name} +${item.quantity}`);
            }
        }

        await connection.commit();
        console.log('Transaction committed successfully');

        // Get the complete bill details for response
        const [[billDetails]] = await connection.execute(
            `SELECT 
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
             WHERE id = ?`,
            [billId]
        );

        const [billItems] = await connection.execute(
            `SELECT 
                BIN_TO_UUID(product_id) as product_id_str,
                quantity,
                unit_price,
                total_price
             FROM bill_items 
             WHERE bill_id = ?`,
            [billId]
        );

        res.json({
            success: true,
            billId: binToUuid(billId),
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
router.get('/search', getShopDetails, async (req, res) => {
    try {
        const { query, type } = req.query;

        if (!query) {
            return res.json({ success: true, bills: [] });
        }

        let searchQuery = '';
        let params = [req.shop.id];

        if (type === 'customer') {
            searchQuery = `
                SELECT 
                    b.*,
                    COUNT(bi.id) as item_count,
                    BIN_TO_UUID(b.id) as bill_id_str
                FROM bills b
                LEFT JOIN bill_items bi ON b.id = bi.bill_id
                WHERE b.shop_id = UUID_TO_BIN(?)
                AND (b.customer_name LIKE ? OR b.customer_phone LIKE ?)
                GROUP BY b.id
                ORDER BY b.created_at DESC
                LIMIT 10
            `;
            params.push(`%${query}%`, `%${query}%`);
        } else if (type === 'bill') {
            searchQuery = `
                SELECT 
                    b.*,
                    COUNT(bi.id) as item_count,
                    BIN_TO_UUID(b.id) as bill_id_str
                FROM bills b
                LEFT JOIN bill_items bi ON b.id = bi.bill_id
                WHERE b.shop_id = UUID_TO_BIN(?)
                AND b.bill_number LIKE ?
                GROUP BY b.id
                ORDER BY b.created_at DESC
                LIMIT 10
            `;
            params.push(`%${query}%`);
        }

        const [bills] = await pool.execute(searchQuery, params);

        res.json({ success: true, bills });
    } catch (err) {
        console.error('Error searching bills:', err);
        res.status(500).json({ success: false, message: 'Failed to search bills' });
    }
});

// GET /bills/:id/items - Get bill items for return
router.get('/:id/items', getShopDetails, async (req, res) => {
    try {
        const billId = uuidToBin(req.params.id);

        const [items] = await pool.execute(`
            SELECT 
                bi.*,
                BIN_TO_UUID(bi.product_id) as product_id_str,
                p.sku,
                COALESCE(i.current_quantity, 0) as current_stock,
                p.brand
            FROM bill_items bi
            LEFT JOIN products p ON bi.product_id = p.id
            LEFT JOIN inventory i ON p.id = i.product_id
            WHERE bi.bill_id = ? 
            AND bi.shop_id = UUID_TO_BIN(?)
        `, [billId, req.shop.id]);

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
            AND shop_id = UUID_TO_BIN(?)
        `, [billId, req.shop.id]);

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
router.get('/:id', getShopDetails, async (req, res) => {
    try {
        const billId = uuidToBin(req.params.id);

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
            AND shop_id = UUID_TO_BIN(?)
        `, [billId, req.shop.id]);

        const [items] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(product_id) as product_id_str,
                quantity,
                unit_price,
                total_price
            FROM bill_items 
            WHERE bill_id = ? 
            AND shop_id = UUID_TO_BIN(?)
        `, [billId, req.shop.id]);

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
router.get('/api/products', getShopDetails, async (req, res) => {
    try {
        const { search } = req.query;
        let query = `
            SELECT 
                BIN_TO_UUID(p.id) as id,
                p.name,
                p.sku,
                COALESCE(i.selling_price, 0) as price,
                COALESCE(i.current_quantity, 0) as stock,
                p.brand
            FROM products p
            LEFT JOIN inventory i ON p.id = i.product_id
            WHERE p.shop_id = UUID_TO_BIN(?)
            AND p.status = 'active'
        `;
        let params = [req.shop.id];

        if (search && search.length > 0) {
            query += ' AND (p.name LIKE ? OR p.sku LIKE ? OR p.brand LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        query += ' ORDER BY p.name LIMIT 20';

        const [products] = await pool.execute(query, params);

        res.json({ success: true, products });
    } catch (err) {
        console.error('Error fetching products:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch products' });
    }
});

// GET /bills/api/customer-bills - Get customer's previous bills
router.get('/api/customer-bills', getShopDetails, async (req, res) => {
    try {
        const { phone, name, search } = req.query;

        if (!phone && !name && !search) {
            return res.json({ success: true, bills: [] });
        }

        let query = `
            SELECT 
                b.*,
                COUNT(bi.id) as item_count,
                BIN_TO_UUID(b.id) as bill_id_str
            FROM bills b
            LEFT JOIN bill_items bi ON b.id = bi.bill_id
            WHERE b.shop_id = UUID_TO_BIN(?)
        `;
        let params = [req.shop.id];

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
router.get('/api/debug-stock', getShopDetails, async (req, res) => {
    try {
        const [products] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(p.id) as id,
                p.name,
                p.sku,
                COALESCE(i.current_quantity, 0) as stock,
                COALESCE(i.selling_price, 0) as selling_price
            FROM products p
            LEFT JOIN inventory i ON p.id = i.product_id
            WHERE p.shop_id = UUID_TO_BIN(?)
            AND p.status = 'active'
            ORDER BY p.name
        `, [req.shop.id]);

        res.json({
            success: true,
            products,
            shopId: req.shop.id
        });
    } catch (err) {
        console.error('Error fetching stock debug info:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch stock info' });
    }
});

module.exports = router;