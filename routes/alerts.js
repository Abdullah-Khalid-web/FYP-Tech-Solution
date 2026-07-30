const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Middleware to get shop-specific table prefix
const getShopPrefix = async (req, res, next) => {
    if (!req.session.shopId) {
        return res.status(403).json({ success: false, message: 'Shop not identified' });
    }

    req.tablePrefix = `shop_${req.session.shopId}_`;

    try {
        // Get shop details from database
        const [shops] = await pool.execute(
            'SELECT * FROM shops WHERE id = UUID_TO_BIN(?)',
            [req.session.shopId]
        );

        req.shop = {
            id: req.session.shopId,
            name: shops[0]?.name || 'My Shop',
            logo: shops[0]?.logo ? `/uploads/shop_logos/${shops[0].logo}` : null,
            address: shops[0]?.address || '',
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
            logo: null,
            currency: 'PKR',
            primary_color: '#007bff',
            secondary_color: '#6c757d'
        };
        next();
    }
};

const ALERTS_PRODUCT_QUERY = `
    SELECT
        BIN_TO_UUID(p.id) as id, p.name, p.brand, p.category, p.size, p.sku,
        COALESCE(i.current_quantity, 0) as quantity,
        COALESCE(i.min_stock_level, 10) as min_stock_alert,
        CAST(COALESCE(i.avg_cost, 0) AS DECIMAL(10,2)) as buying_price,
        CAST(COALESCE(i.selling_price, 0) AS DECIMAL(10,2)) as selling_price,
        p.status
     FROM products p
     LEFT JOIN inventory i ON p.id = i.product_id
     WHERE p.shop_id = UUID_TO_BIN(?)`;

// GET stock alerts page
router.get('/', getShopPrefix, async (req, res) => {
    try {
        // Get all products with their inventory levels
        const [products] = await pool.execute(
            `${ALERTS_PRODUCT_QUERY} ORDER BY quantity ASC, p.name ASC`,
            [req.session.shopId]
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

        res.render('alerts/index', {
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

// GET API endpoint for stock alerts (for AJAX calls)
router.get('/api', getShopPrefix, async (req, res) => {
    try {
        const [products] = await pool.execute(
            `${ALERTS_PRODUCT_QUERY} ORDER BY quantity ASC, p.name ASC`,
            [req.session.shopId]
        );

        const criticalAlerts = products.filter(product => 
            product.quantity === 0 || product.quantity < product.min_stock_alert / 2
        );
        
        const warningAlerts = products.filter(product => 
            product.quantity > 0 && 
            product.quantity >= product.min_stock_alert / 2 && 
            product.quantity <= product.min_stock_alert
        );

        res.json({
            success: true,
            data: {
                criticalAlerts,
                warningAlerts,
                criticalCount: criticalAlerts.length,
                warningCount: warningAlerts.length,
                totalCount: products.length
            }
        });
    } catch (err) {
        console.error('Error fetching stock alerts API:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching stock alerts'
        });
    }
});

// GET low stock products only
router.get('/low-stock', getShopPrefix, async (req, res) => {
    try {
        const [products] = await pool.execute(
            `SELECT * FROM (${ALERTS_PRODUCT_QUERY}) alert_products
             WHERE quantity <= min_stock_alert
             ORDER BY quantity ASC, name ASC`,
            [req.session.shopId]
        );

        res.render('alerts/low-stock', {
            title: 'Low Stock Products',
            products,
            productsCount: products.length,
            shop: req.shop || {}
        });
    } catch (err) {
        console.error('Error fetching low stock products:', err);
        res.status(500).render('error', {
            title: 'Error',
            message: 'An error occurred while fetching low stock products'
        });
    }
});

// GET out of stock products only
router.get('/out-of-stock', getShopPrefix, async (req, res) => {
    try {
        const [products] = await pool.execute(
            `SELECT * FROM (${ALERTS_PRODUCT_QUERY}) alert_products
             WHERE quantity = 0
             ORDER BY name ASC`,
            [req.session.shopId]
        );

        res.render('alerts/out-of-stock', {
            title: 'Out of Stock Products',
            products,
            productsCount: products.length,
            shop: req.shop || {}
        });
    } catch (err) {
        console.error('Error fetching out of stock products:', err);
        res.status(500).render('error', {
            title: 'Error',
            message: 'An error occurred while fetching out of stock products'
        });
    }
});

module.exports = router;