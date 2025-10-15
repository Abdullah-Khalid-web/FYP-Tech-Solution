const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Middleware to get shop-specific table prefix
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

// Configure multer for product images
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploads/products');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// GET /inventory - Inventory management page
router.get('/', getShopPrefix, async (req, res) => {
    try {
        res.render('inventory/index', {
            title: 'Inventory Management',
            shop: req.shop
        });
    } catch (err) {
        console.error('Error loading inventory page:', err);
        res.status(500).render('error', {
            message: 'Failed to load inventory management'
        });
    }
});

// API: GET /api/inventory/products - Get all products
router.get('/api/products', getShopPrefix, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            category = '',
            status = '',
            lowStock = false
        } = req.query;

        const offset = (page - 1) * limit;

        let whereConditions = ['1=1'];
        let queryParams = [];

        if (search) {
            whereConditions.push('(name LIKE ? OR brand LIKE ? OR sku LIKE ? OR barcode LIKE ?)');
            const searchTerm = `%${search}%`;
            queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }

        if (category) {
            whereConditions.push('category = ?');
            queryParams.push(category);
        }

        if (status) {
            whereConditions.push('status = ?');
            queryParams.push(status);
        }

        if (lowStock === 'true') {
            whereConditions.push('quantity <= min_stock_alert');
        }

        const whereClause = whereConditions.join(' AND ');

        // Get products
        const [products] = await pool.execute(`
            SELECT * FROM ${req.tablePrefix}products 
            WHERE ${whereClause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `, [...queryParams, parseInt(limit), parseInt(offset)]);

        // Get total count
        const [[countResult]] = await pool.execute(`
            SELECT COUNT(*) as total 
            FROM ${req.tablePrefix}products 
            WHERE ${whereClause}
        `, queryParams);

        // Get categories for filter
        const [categories] = await pool.execute(`
            SELECT DISTINCT category 
            FROM ${req.tablePrefix}products 
            WHERE category IS NOT NULL AND category != ''
            ORDER BY category
        `);

        // Get low stock count
        const [[lowStockCount]] = await pool.execute(`
            SELECT COUNT(*) as count 
            FROM ${req.tablePrefix}products 
            WHERE quantity <= min_stock_alert AND status = 'active'
        `);

        res.json({
            success: true,
            products: products,
            totalPages: Math.ceil(countResult.total / limit),
            categories: categories.map(c => c.category),
            stats: {
                totalProducts: countResult.total,
                lowStockCount: lowStockCount.count,
                activeProducts: products.filter(p => p.status === 'active').length
            }
        });

    } catch (err) {
        console.error('Error fetching products:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load products'
        });
    }
});

// API: GET /api/inventory/products/:id - Get single product
router.get('/api/products/:id', getShopPrefix, async (req, res) => {
    try {
        const productId = req.params.id;

        const [[product]] = await pool.execute(`
            SELECT * FROM ${req.tablePrefix}products WHERE id = ?
        `, [productId]);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        res.json({
            success: true,
            product: product
        });

    } catch (err) {
        console.error('Error fetching product:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load product'
        });
    }
});

// API: POST /api/inventory/products - Create new product
router.post('/api/products', getShopPrefix, upload.single('image'), async (req, res) => {
    let connection;
    try {
        const {
            name,
            brand,
            category,
            size,
            sku,
            barcode,
            quantity,
            min_stock_alert,
            buying_price,
            selling_price,
            tax_percent,
            status
        } = req.body;

        // Validation
        if (!name || !buying_price || !selling_price) {
            return res.status(400).json({
                success: false,
                message: 'Product name, buying price, and selling price are required'
            });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Check if SKU or barcode already exists
        if (sku) {
            const [existingSku] = await connection.execute(
                `SELECT id FROM ${req.tablePrefix}products WHERE sku = ?`,
                [sku]
            );
            if (existingSku.length > 0) {
                throw new Error('SKU already exists');
            }
        }

        if (barcode) {
            const [existingBarcode] = await connection.execute(
                `SELECT id FROM ${req.tablePrefix}products WHERE barcode = ?`,
                [barcode]
            );
            if (existingBarcode.length > 0) {
                throw new Error('Barcode already exists');
            }
        }

        // Insert product
        const [result] = await connection.execute(`
            INSERT INTO ${req.tablePrefix}products 
            (name, brand, category, size, sku, barcode, image, quantity, min_stock_alert, 
             buying_price, selling_price, tax_percent, status, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
            name,
            brand || null,
            category || null,
            size || null,
            sku || null,
            barcode || null,
            req.file ? req.file.filename : null,
            parseInt(quantity) || 0,
            parseInt(min_stock_alert) || 5,
            parseFloat(buying_price),
            parseFloat(selling_price),
            parseFloat(tax_percent) || 0,
            status || 'active',
            req.session.userId
        ]);

        // Log the action
        await connection.execute(`
            INSERT INTO ${req.tablePrefix}active_log_user 
            (user_id, action, action_type, created_at)
            VALUES (?, ?, 'product_create', NOW())
        `, [req.session.userId, `Created product: ${name}`]);

        await connection.commit();

        res.json({
            success: true,
            message: 'Product created successfully',
            productId: result.insertId
        });

    } catch (err) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }

        // Delete uploaded file if exists
        if (req.file) {
            fs.unlink(req.file.path, () => {});
        }

        console.error('Error creating product:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to create product'
        });
    }
});

// API: PUT /api/inventory/products/:id - Update product
router.put('/api/products/:id', getShopPrefix, upload.single('image'), async (req, res) => {
    let connection;
    try {
        const productId = req.params.id;
        const {
            name,
            brand,
            category,
            size,
            sku,
            barcode,
            quantity,
            min_stock_alert,
            buying_price,
            selling_price,
            tax_percent,
            status
        } = req.body;

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Check if product exists
        const [[existingProduct]] = await connection.execute(
            `SELECT * FROM ${req.tablePrefix}products WHERE id = ?`,
            [productId]
        );

        if (!existingProduct) {
            throw new Error('Product not found');
        }

        // Check if SKU or barcode already exists (excluding current product)
        if (sku && sku !== existingProduct.sku) {
            const [existingSku] = await connection.execute(
                `SELECT id FROM ${req.tablePrefix}products WHERE sku = ? AND id != ?`,
                [sku, productId]
            );
            if (existingSku.length > 0) {
                throw new Error('SKU already exists');
            }
        }

        if (barcode && barcode !== existingProduct.barcode) {
            const [existingBarcode] = await connection.execute(
                `SELECT id FROM ${req.tablePrefix}products WHERE barcode = ? AND id != ?`,
                [barcode, productId]
            );
            if (existingBarcode.length > 0) {
                throw new Error('Barcode already exists');
            }
        }

        // Update product
        await connection.execute(`
            UPDATE ${req.tablePrefix}products 
            SET name = ?, brand = ?, category = ?, size = ?, sku = ?, barcode = ?,
                quantity = ?, min_stock_alert = ?, buying_price = ?, selling_price = ?,
                tax_percent = ?, status = ?, updated_at = NOW()
                ${req.file ? ', image = ?' : ''}
            WHERE id = ?
        `, [
            name,
            brand || null,
            category || null,
            size || null,
            sku || null,
            barcode || null,
            parseInt(quantity) || 0,
            parseInt(min_stock_alert) || 5,
            parseFloat(buying_price),
            parseFloat(selling_price),
            parseFloat(tax_percent) || 0,
            status || 'active',
            ...(req.file ? [req.file.filename] : []),
            productId
        ]);

        // Log the action
        await connection.execute(`
            INSERT INTO ${req.tablePrefix}active_log_user 
            (user_id, action, action_type, created_at)
            VALUES (?, ?, 'product_update', NOW())
        `, [req.session.userId, `Updated product: ${name}`]);

        // Delete old image if new one uploaded
        if (req.file && existingProduct.image) {
            const oldImagePath = path.join(__dirname, '../../uploads/products', existingProduct.image);
            if (fs.existsSync(oldImagePath)) {
                fs.unlink(oldImagePath, () => {});
            }
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Product updated successfully'
        });

    } catch (err) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }

        // Delete uploaded file if exists
        if (req.file) {
            fs.unlink(req.file.path, () => {});
        }

        console.error('Error updating product:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to update product'
        });
    }
});

// API: DELETE /api/inventory/products/:id - Delete product
router.delete('/api/products/:id', getShopPrefix, async (req, res) => {
    let connection;
    try {
        const productId = req.params.id;

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Check if product exists and get details for logging
        const [[product]] = await connection.execute(
            `SELECT * FROM ${req.tablePrefix}products WHERE id = ?`,
            [productId]
        );

        if (!product) {
            throw new Error('Product not found');
        }

        // Check if product is used in any bills
        const [billItems] = await connection.execute(
            `SELECT COUNT(*) as count FROM ${req.tablePrefix}bill_items WHERE product_id = ?`,
            [productId]
        );

        if (billItems[0].count > 0) {
            throw new Error('Cannot delete product that has been used in sales');
        }

        // Delete product
        await connection.execute(
            `DELETE FROM ${req.tablePrefix}products WHERE id = ?`,
            [productId]
        );

        // Log the action
        await connection.execute(`
            INSERT INTO ${req.tablePrefix}active_log_user 
            (user_id, action, action_type, created_at)
            VALUES (?, ?, 'product_delete', NOW())
        `, [req.session.userId, `Deleted product: ${product.name}`]);

        // Delete product image if exists
        if (product.image) {
            const imagePath = path.join(__dirname, '../../uploads/products', product.image);
            if (fs.existsSync(imagePath)) {
                fs.unlink(imagePath, () => {});
            }
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Product deleted successfully'
        });

    } catch (err) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }

        console.error('Error deleting product:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to delete product'
        });
    }
});

// API: POST /api/inventory/products/:id/stock - Update stock
router.post('/api/products/:id/stock', getShopPrefix, async (req, res) => {
    let connection;
    try {
        const productId = req.params.id;
        const { quantity, action, notes } = req.body; // action: 'add', 'remove', 'set'

        if (!quantity || isNaN(quantity)) {
            return res.status(400).json({
                success: false,
                message: 'Valid quantity is required'
            });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Get current product
        const [[product]] = await connection.execute(
            `SELECT * FROM ${req.tablePrefix}products WHERE id = ?`,
            [productId]
        );

        if (!product) {
            throw new Error('Product not found');
        }

        let newQuantity = product.quantity;

        switch (action) {
            case 'add':
                newQuantity += parseInt(quantity);
                break;
            case 'remove':
                newQuantity = Math.max(0, newQuantity - parseInt(quantity));
                break;
            case 'set':
                newQuantity = parseInt(quantity);
                break;
            default:
                throw new Error('Invalid action');
        }

        // Update stock
        await connection.execute(
            `UPDATE ${req.tablePrefix}products SET quantity = ?, updated_at = NOW() WHERE id = ?`,
            [newQuantity, productId]
        );

        // Log stock adjustment
        await connection.execute(`
            INSERT INTO ${req.tablePrefix}active_log_user 
            (user_id, action, action_type, created_at)
            VALUES (?, ?, 'stock_adjustment', NOW())
        `, [req.session.userId, `Stock ${action}: ${product.name} (${quantity} units)`]);

        await connection.commit();

        res.json({
            success: true,
            message: `Stock updated successfully. New quantity: ${newQuantity}`,
            newQuantity: newQuantity
        });

    } catch (err) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }

        console.error('Error updating stock:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to update stock'
        });
    }
});

// API: GET /api/inventory/categories - Get product categories
router.get('/api/categories', getShopPrefix, async (req, res) => {
    try {
        const [categories] = await pool.execute(`
            SELECT category, COUNT(*) as product_count,
                   SUM(quantity) as total_stock,
                   AVG(selling_price) as avg_price
            FROM ${req.tablePrefix}products 
            WHERE category IS NOT NULL AND category != '' AND status = 'active'
            GROUP BY category
            ORDER BY category
        `);

        res.json({
            success: true,
            categories: categories
        });

    } catch (err) {
        console.error('Error fetching categories:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load categories'
        });
    }
});

// API: GET /api/inventory/low-stock - Get low stock products
router.get('/api/low-stock', getShopPrefix, async (req, res) => {
    try {
        const [lowStockProducts] = await pool.execute(`
            SELECT * FROM ${req.tablePrefix}products 
            WHERE quantity <= min_stock_alert AND status = 'active'
            ORDER BY quantity ASC
            LIMIT 50
        `);

        res.json({
            success: true,
            products: lowStockProducts
        });

    } catch (err) {
        console.error('Error fetching low stock products:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load low stock products'
        });
    }
});

// API: GET /api/inventory/stats - Get inventory statistics
router.get('/api/stats', getShopPrefix, async (req, res) => {
    try {
        const [[totalStats]] = await pool.execute(`
            SELECT 
                COUNT(*) as total_products,
                SUM(quantity) as total_stock,
                SUM(quantity * buying_price) as total_investment,
                SUM(quantity * selling_price) as total_value,
                AVG(selling_price - buying_price) as avg_profit_margin
            FROM ${req.tablePrefix}products 
            WHERE status = 'active'
        `);

        const [[lowStockStats]] = await pool.execute(`
            SELECT COUNT(*) as low_stock_count
            FROM ${req.tablePrefix}products 
            WHERE quantity <= min_stock_alert AND status = 'active'
        `);

        const [[categoryStats]] = await pool.execute(`
            SELECT COUNT(DISTINCT category) as category_count
            FROM ${req.tablePrefix}products 
            WHERE category IS NOT NULL AND category != ''
        `);

        res.json({
            success: true,
            stats: {
                totalProducts: totalStats.total_products || 0,
                totalStock: totalStats.total_stock || 0,
                totalInvestment: totalStats.total_investment || 0,
                totalValue: totalStats.total_value || 0,
                avgProfitMargin: totalStats.avg_profit_margin || 0,
                lowStockCount: lowStockStats.low_stock_count || 0,
                categoryCount: categoryStats.category_count || 0
            }
        });

    } catch (err) {
        console.error('Error fetching inventory stats:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load inventory statistics'
        });
    }
});

module.exports = router;