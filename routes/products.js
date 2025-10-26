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

// GET suppliers for dropdown
router.get('/suppliers/list', getShopPrefix, async (req, res) => {
    try {
        const [suppliers] = await pool.execute(
            `SELECT id, name, contact_person 
             FROM ${req.tablePrefix}suppliers 
             WHERE status = 'active' 
             ORDER BY name ASC`
        );

        res.json({
            success: true,
            suppliers
        });
    } catch (err) {
        console.error('Error fetching suppliers:', err);
        res.status(500).json({
            success: false,
            message: 'Error loading suppliers'
        });
    }
});

// GET products listing
router.get('/', getShopPrefix, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;

        // Get products with supplier count and primary supplier info
        const [products] = await pool.execute(
            `SELECT 
                p.id, p.name, p.brand, p.category, p.size, p.sku, p.barcode,
                p.quantity, p.min_stock_alert,
                CAST(p.buying_price AS DECIMAL(10,2)) as buying_price,
                CAST(p.selling_price AS DECIMAL(10,2)) as selling_price,
                CAST(p.tax_percent AS DECIMAL(5,2)) as tax_percent,
                p.image, p.status,
                COUNT(DISTINCT sp.supplier_id) as supplier_count,
                s.name as primary_supplier_name,
                p.supplier_id
             FROM ${req.tablePrefix}products p
             LEFT JOIN ${req.tablePrefix}supplier_products sp ON p.id = sp.product_id
             LEFT JOIN ${req.tablePrefix}suppliers s ON p.supplier_id = s.id
             GROUP BY p.id, p.name, p.brand, p.category, p.size, p.sku, p.barcode,
                      p.quantity, p.min_stock_alert, p.buying_price, p.selling_price,
                      p.tax_percent, p.image, p.status, s.name, p.supplier_id
             ORDER BY p.created_at DESC 
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
router.post('/', getShopPrefix, upload.single('image'), async (req, res) => {
    try {
        const {
            name, brand, category, size, sku, barcode,
            quantity, min_stock_alert, buying_price, selling_price, tax_percent,
            supplier_id
        } = req.body;

        // Validate required fields
        if (!name || !selling_price || !quantity) {
            return res.status(400).json({
                success: false,
                message: 'Name, selling price, and quantity are required'
            });
        }

        // Handle image upload - set to NULL if no file uploaded
        let image = null;
        if (req.file) {
            image = req.file.filename;
        }

        await pool.execute(
            `INSERT INTO ${req.tablePrefix}products 
             (name, brand, category, size, sku, barcode, quantity, min_stock_alert, 
              buying_price, selling_price, tax_percent, image, supplier_id, created_by, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [
                name,
                brand || null,
                category || null,
                size || null,
                sku || null,
                barcode || null,
                parseInt(quantity),
                parseInt(min_stock_alert) || 5,
                buying_price ? parseFloat(buying_price) : null,
                parseFloat(selling_price),
                parseFloat(tax_percent) || 0,
                image,
                supplier_id || null,
                req.session.userId
            ]
        );

        res.json({ success: true, message: 'Product added successfully' });
    } catch (err) {
        // Delete uploaded file if there was an error
        if (req.file) {
            fs.unlink(req.file.path, () => { });
        }
        console.error('Error creating product:', err);
        res.status(500).json({
            success: false,
            message: 'Error creating product'
        });
    }
});

// GET product for editing
router.get('/:id/edit', getShopPrefix, async (req, res) => {
    try {
        const productId = req.params.id;
        
        const [products] = await pool.execute(
            `SELECT 
                p.id, p.name, p.brand, p.category, p.size, p.sku, p.barcode,
                p.quantity, p.min_stock_alert,
                CAST(p.buying_price AS DECIMAL(10,2)) as buying_price,
                CAST(p.selling_price AS DECIMAL(10,2)) as selling_price,
                CAST(p.tax_percent AS DECIMAL(5,2)) as tax_percent,
                p.image, p.status, p.supplier_id,
                s.name as supplier_name
             FROM ${req.tablePrefix}products p
             LEFT JOIN ${req.tablePrefix}suppliers s ON p.supplier_id = s.id
             WHERE p.id = ?`,
            [productId]
        );
        
        if (products.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found' 
            });
        }
        
        res.json({
            success: true,
            product: products[0]
        });
    } catch (err) {
        console.error('Error fetching product for edit:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error loading product details' 
        });
    }
});

// PUT update product
router.put('/:id', getShopPrefix, upload.single('image'), async (req, res) => {
    try {
        const {
            name, brand, category, size, sku, barcode,
            min_stock_alert, buying_price, selling_price, tax_percent, remove_image,
            supplier_id
        } = req.body;
        
        // First get current product to handle image updates
        const [products] = await pool.execute(
            `SELECT image FROM ${req.tablePrefix}products WHERE id = ?`,
            [req.params.id]
        );
        
        if (products.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found' 
            });
        }
        
        const currentProduct = products[0];
        let image = currentProduct.image;
        
        // Handle image removal
        if (remove_image === 'on' && currentProduct.image) {
            const imagePath = path.join(__dirname, '../uploads', currentProduct.image);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
            image = null;
        }
        
        // Handle new image upload
        if (req.file) {
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
                 image = ?, supplier_id = ?, updated_at = NOW()
             WHERE id = ?`,
            [
                name, 
                brand || null, 
                category || null, 
                size || null, 
                sku || null, 
                barcode || null,
                parseInt(min_stock_alert) || 5,
                parseFloat(buying_price), 
                parseFloat(selling_price), 
                parseFloat(tax_percent) || 0,
                image,
                supplier_id || null,
                req.params.id
            ]
        );
        
        res.json({ 
            success: true, 
            message: 'Product updated successfully' 
        });
    } catch (err) {
        console.error('Error updating product:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error updating product' 
        });
    }
});

// POST update product (legacy route)
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
            const imagePath = path.join(__dirname, '../uploads', currentProduct.image);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
            image = null;
        }

        // Handle new image upload
        if (req.file) {
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

// GET product suppliers
router.get('/:id/suppliers', getShopPrefix, async (req, res) => {
    try {
        const productId = req.params.id;

        const [suppliers] = await pool.execute(
            `SELECT 
                sp.*,
                s.name as supplier_name,
                s.contact_person,
                s.email,
                s.phone
             FROM ${req.tablePrefix}supplier_products sp
             JOIN ${req.tablePrefix}suppliers s ON sp.supplier_id = s.id
             WHERE sp.product_id = ?
             ORDER BY s.name ASC`,
            [productId]
        );

        // Get all available suppliers for adding to product
        const [availableSuppliers] = await pool.execute(
            `SELECT id, name, contact_person 
             FROM ${req.tablePrefix}suppliers 
             WHERE status = 'active' 
             AND id NOT IN (
                 SELECT supplier_id FROM ${req.tablePrefix}supplier_products WHERE product_id = ?
             )
             ORDER BY name ASC`,
            [productId]
        );

        res.json({
            success: true,
            suppliers,
            availableSuppliers
        });
    } catch (err) {
        console.error('Error fetching product suppliers:', err);
        res.status(500).json({
            success: false,
            message: 'Error loading product suppliers'
        });
    }
});

// POST add supplier to product
router.post('/:id/suppliers', getShopPrefix, async (req, res) => {
    try {
        const { supplier_id, supplier_sku, supplier_price, min_order_quantity, lead_time_days } = req.body;
        const productId = req.params.id;

        await pool.execute(
            `INSERT INTO ${req.tablePrefix}supplier_products 
             (supplier_id, product_id, supplier_sku, supplier_price, min_order_quantity, lead_time_days)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                supplier_id,
                productId,
                supplier_sku || null,
                supplier_price ? parseFloat(supplier_price) : null,
                min_order_quantity ? parseInt(min_order_quantity) : 1,
                lead_time_days ? parseInt(lead_time_days) : null
            ]
        );

        res.json({ success: true, message: 'Supplier added to product successfully' });
    } catch (err) {
        console.error('Error adding supplier to product:', err);
        res.status(500).json({
            success: false,
            message: 'Error adding supplier to product'
        });
    }
});

// PUT update product supplier
router.put('/:id/suppliers/:supplierId', getShopPrefix, async (req, res) => {
    try {
        const { supplier_sku, supplier_price, min_order_quantity, lead_time_days } = req.body;
        const productId = req.params.id;
        const supplierId = req.params.supplierId;

        await pool.execute(
            `UPDATE ${req.tablePrefix}supplier_products 
             SET supplier_sku = ?, supplier_price = ?, min_order_quantity = ?, lead_time_days = ?, updated_at = NOW()
             WHERE product_id = ? AND supplier_id = ?`,
            [
                supplier_sku || null,
                supplier_price ? parseFloat(supplier_price) : null,
                min_order_quantity ? parseInt(min_order_quantity) : 1,
                lead_time_days ? parseInt(lead_time_days) : null,
                productId,
                supplierId
            ]
        );

        res.json({ success: true, message: 'Product supplier updated successfully' });
    } catch (err) {
        console.error('Error updating product supplier:', err);
        res.status(500).json({
            success: false,
            message: 'Error updating product supplier'
        });
    }
});

// DELETE remove supplier from product
router.delete('/:id/suppliers/:supplierId', getShopPrefix, async (req, res) => {
    try {
        const productId = req.params.id;
        const supplierId = req.params.supplierId;

        await pool.execute(
            `DELETE FROM ${req.tablePrefix}supplier_products 
             WHERE product_id = ? AND supplier_id = ?`,
            [productId, supplierId]
        );

        res.json({ success: true, message: 'Supplier removed from product successfully' });
    } catch (err) {
        console.error('Error removing supplier from product:', err);
        res.status(500).json({
            success: false,
            message: 'Error removing supplier from product'
        });
    }
});

// GET stock alerts page
router.get('/alerts', getShopPrefix, async (req, res) => {
    try {
        // Get all products
        const [products] = await pool.execute(
            `SELECT 
                id, name, brand, category, size, sku,
                quantity, min_stock_alert,
                CAST(buying_price AS DECIMAL(10,2)) as buying_price,
                CAST(selling_price AS DECIMAL(10,2)) as selling_price,
                image, status
             FROM ${req.tablePrefix}products 
             ORDER BY quantity ASC, name ASC`
        );

        // Categorize alerts
        const criticalAlerts = products.filter(product => 
            product.quantity === 0 || product.quantity < product.min_stock_alert / 2
        );
        
        const warningAlerts = products.filter(product => 
            product.quantity > 0 && 
            product.quantity >= product.min_stock_alert / 2 && 
            product.quantity <= product.min_stock_alert
        );
        
        const infoAlerts = products.filter(product => 
            product.quantity > product.min_stock_alert && 
            product.quantity <= product.min_stock_alert * 2
        );

        res.render('alerts', {
            title: 'Stock Alerts',
            criticalAlerts,
            warningAlerts,
            infoAlerts,
            criticalAlertsCount: criticalAlerts.length,
            warningAlertsCount: warningAlerts.length,
            infoAlertsCount: infoAlerts.length,
            totalProducts: products.length,
            shop: req.shop || {}
        });
    } catch (err) {
        console.error('Error fetching stock alerts:', err);
        res.status(500).render('error', {
            title: 'Error',
            message: 'An error occurred while fetching stock alerts'
        });
    }
});

// GET product statistics
router.get('/stats', getShopPrefix, async (req, res) => {
    try {
        // Get total products count
        const [productsCount] = await pool.execute(
            `SELECT COUNT(*) as total FROM ${req.tablePrefix}products WHERE status = 'active'`
        );
        
        // Get total stock quantity
        const [stockResult] = await pool.execute(
            `SELECT SUM(quantity) as total FROM ${req.tablePrefix}products WHERE status = 'active'`
        );
        
        // Get total investment (sum of quantity * buying_price)
        const [investmentResult] = await pool.execute(
            `SELECT SUM(quantity * buying_price) as total FROM ${req.tablePrefix}products WHERE status = 'active'`
        );
        
        // Get low stock count (products with quantity <= min_stock_alert)
        const [lowStockResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM ${req.tablePrefix}products 
             WHERE status = 'active' AND quantity <= min_stock_alert`
        );
        
        res.json({
            success: true,
            stats: {
                totalProducts: productsCount[0].total || 0,
                totalStock: stockResult[0].total || 0,
                totalInvestment: investmentResult[0].total || 0,
                lowStockCount: lowStockResult[0].total || 0
            }
        });
    } catch (err) {
        console.error('Error fetching product stats:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching product statistics'
        });
    }
})

module.exports = router;