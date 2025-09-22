const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for product images
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// Middleware to get shop-specific table prefix
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

// GET products listing
router.get('/', getShopPrefix, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        
        // Get products
const [products] = await pool.execute(
    `SELECT 
        id, name, brand, category, size, sku, barcode,
        quantity, min_stock_alert,
        CAST(buying_price AS DECIMAL(10,2)) as buying_price,
        CAST(selling_price AS DECIMAL(10,2)) as selling_price,
        CAST(tax_percent AS DECIMAL(5,2)) as tax_percent,
        image, status
     FROM ${req.tablePrefix}products 
     ORDER BY created_at DESC 
     LIMIT ? OFFSET ?`, 
    [limit, offset]
);
        
        // Get total count for pagination
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM ${req.tablePrefix}products`
        );
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);
        
        // Get distinct categories for filter dropdown
        const [categoriesResult] = await pool.execute(
            `SELECT DISTINCT category FROM ${req.tablePrefix}products WHERE category IS NOT NULL`
        );
        const categories = categoriesResult.map(item => item.category);
        
        res.render('products/index', {
            title: 'Products',
            products,
            categories,
            currentPage: page,
            totalPages,
            shop: req.shop || {} 
        });
    } catch (err) {
        console.error('Error fetching products:', err);
        res.status(500).render('error', {
            title: 'Error',
            message: 'An error occurred while fetching products'
        });
    }
});

// POST create new product
// POST create new product
router.post('/', getShopPrefix, upload.single('image'), async (req, res) => {
    try {
        const {
            name, brand, category, size, sku, barcode,
            quantity, min_stock_alert, buying_price, selling_price, tax_percent
        } = req.body;

        // ✅ Validate required fields
        if (!name || !selling_price || !quantity) {
            return res.status(400).json({
                success: false,
                message: 'Name, selling price, and quantity are required'
            });
        }

        const image = req.file ? req.file.filename : null;

        await pool.execute(
            `INSERT INTO ${req.tablePrefix}products 
             (name, brand, category, size, sku, barcode, quantity, min_stock_alert, 
              buying_price, selling_price, tax_percent, image, created_by, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [
                name,
                brand || null,
                category || null,
                size || null,
                sku || null,
                barcode || null,
                parseInt(quantity), // ✅ required
                parseInt(min_stock_alert) || 5,
                buying_price ? parseFloat(buying_price) : null, // ✅ optional
                parseFloat(selling_price), // ✅ required
                parseFloat(tax_percent) || 0,
                image || null, // ✅ optional
                req.session.userId
            ]
        );

        res.json({ success: true, message: 'Product added successfully' });
    } catch (err) {
        // Delete uploaded file if there was an error
        if (req.file) {
            fs.unlink(req.file.path, () => {});
        }
        console.error('Error creating product:', err);
        res.status(500).json({
            success: false,
            message: 'Error creating product'
        });
    }
});


// GET product for editing
// GET product edit page


// POST update product
router.post('/:id/update', getShopPrefix, upload.single('image'), async (req, res) => {
    try {
        const {
            name, brand, category, size, sku, barcode,
            min_stock_alert, buying_price, selling_price, tax_percent, remove_image
        } = req.body;
        
        // First get current product to handle image updates
        const [products] = await pool.execute(
            `SELECT image FROM ${req.tablePrefix}products WHERE id = ?`,
            [req.params.id]
        );
        
        if (products.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        
        const currentProduct = products[0];
        let image = currentProduct.image;
        
        // Handle image removal
        if (remove_image === 'on' && currentProduct.image) {
            // Delete the old image file
            const imagePath = path.join(__dirname, '../uploads', currentProduct.image);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
            image = null;
        }
        
        // Handle new image upload
        if (req.file) {
            // Delete the old image file if exists
            if (currentProduct.image) {
                const oldImagePath = path.join(__dirname, '../uploads', currentProduct.image);
                if (fs.existsSync(oldImagePath)) {
                    fs.unlinkSync(oldImagePath);
                }
            }
            image = req.file.filename;
        }
        
        await pool.execute(
            `UPDATE ${req.tablePrefix}products 
             SET name = ?, brand = ?, category = ?, size = ?, sku = ?, barcode = ?, 
                 min_stock_alert = ?, buying_price = ?, selling_price = ?, tax_percent = ?, 
                 image = ?, updated_at = NOW()
             WHERE id = ?`,
            [
                name, brand || null, category || null, size || null, sku || null, barcode || null,
                parseInt(min_stock_alert) || 5,
                parseFloat(buying_price), parseFloat(selling_price), parseFloat(tax_percent) || 0,
                image, req.params.id
            ]
        );
        
        res.json({ success: true, message: 'Product updated successfully' });
    } catch (err) {
        console.error('Error updating product:', err);
        res.status(500).json({ success: false, message: 'Error updating product' });
    }
});

// POST add stock to product
router.post('/add-stock', getShopPrefix, async (req, res) => {
    try {
        const { product_id, quantity, buying_price } = req.body;
        
        // Start transaction
        await pool.query('START TRANSACTION');
        
        // Update quantity
        await pool.execute(
            `UPDATE ${req.tablePrefix}products 
             SET quantity = quantity + ? 
             WHERE id = ?`,
            [parseInt(quantity), product_id]
        );
        
        // Update buying price if provided
        if (buying_price) {
            await pool.execute(
                `UPDATE ${req.tablePrefix}products 
                 SET buying_price = ? 
                 WHERE id = ?`,
                [parseFloat(buying_price), product_id]
            );
        }
        
        // Commit transaction
        await pool.query('COMMIT');
        
        res.json({ success: true, message: 'Stock updated successfully' });
    } catch (err) {
        // Rollback on error
        await pool.query('ROLLBACK');
        console.error('Error adding stock:', err);
        res.status(500).json({ success: false, message: 'Error adding stock' });
    }
});

// POST toggle product status
router.post('/:id/toggle-status', getShopPrefix, async (req, res) => {
    try {
        await pool.execute(
            `UPDATE ${req.tablePrefix}products 
             SET status = CASE WHEN status = 'active' THEN 'inactive' ELSE 'active' END 
             WHERE id = ?`,
            [req.params.id]
        );
        
        res.json({ success: true, message: 'Product status updated' });
    } catch (err) {
        console.error('Error toggling product status:', err);
        res.status(500).json({ success: false, message: 'Error toggling product status' });
    }
});

module.exports = router;