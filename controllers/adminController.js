// routes/admin.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');

// Disable global layout for all admin routes
router.use((req, res, next) => {
    res.locals.layout = false;
    next();
});

// Helper function to convert UUID to binary
function uuidToBinary(uuid) {
    return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

// Helper function to convert binary to UUID
function binaryToUuid(buffer) {
    const hex = buffer.toString('hex');
    return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}`;
}

// Admin credentials
const ADMIN_CREDENTIALS = {
    username: 'aa',
    password: 'aa'
};

// Admin login page
router.get('/', (req, res) => {
    if (req.session.admin) {
        return res.redirect('/admin/dashboard');
    }
    res.render('admin/login', { 
        title: 'Admin Login',
        error: null 
    });
});

// Admin login handler
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
        // Create a dummy admin user ID
        const adminUuid = uuidv4();
        
        req.session.admin = {
            id: uuidToBinary(adminUuid), // Store as binary for database
            username: username,
            loginTime: new Date()
        };
        return res.redirect('/admin/dashboard');
    } else {
        res.render('admin/login', {
            title: 'Admin Login',
            error: 'Invalid credentials'
        });
    }
});

// Admin logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin');
});

// Middleware to check if admin is logged in
const requireAdmin = (req, res, next) => {
    if (req.session.admin) {
        next();
    } else {
        res.redirect('/admin');
    }
};

// Admin dashboard
router.get('/dashboard', requireAdmin, async (req, res) => {
    try {
        // Get shops statistics
        const [shops] = await pool.execute(`
            SELECT 
                COUNT(*) as totalShops,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as activeShops,
                SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) as inactiveShops,
                SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as blockedShops
            FROM shops
        `);

        // Get subscription statistics
        const [subscriptions] = await pool.execute(`
            SELECT 
                COUNT(*) as totalSubscriptions,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as activeSubscriptions,
                SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expiredSubscriptions,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelledSubscriptions
            FROM subscriptions
        `);

        // Get recent shops
        const [recentShops] = await pool.execute(`
            SELECT s.*, sub.plan_name, sub.expires_at, sub.status as subscription_status
            FROM shops s
            LEFT JOIN (
                SELECT * FROM subscriptions 
                WHERE status = 'active' 
                ORDER BY created_at DESC
            ) sub ON s.id = sub.shop_id
            ORDER BY s.created_at DESC
            LIMIT 5
        `);

        // Convert binary UUIDs to string for template
        const processedShops = recentShops.map(shop => ({
            ...shop,
            id: binaryToUuid(shop.id)
        }));

        // Get expiring subscriptions (within 7 days)
        const [expiringSubscriptions] = await pool.execute(`
            SELECT s.name as shop_name, sub.*, 
                   DATEDIFF(sub.expires_at, CURDATE()) as days_remaining
            FROM subscriptions sub
            JOIN shops s ON sub.shop_id = s.id
            WHERE sub.status = 'active' 
            AND sub.expires_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
            ORDER BY sub.expires_at ASC
        `);

        // Process subscriptions to convert UUIDs
        const processedSubscriptions = expiringSubscriptions.map(sub => ({
            ...sub,
            id: binaryToUuid(sub.id),
            shop_id: binaryToUuid(sub.shop_id)
        }));

        res.render('admin/dashboard', {
            title: 'Admin Dashboard',
            stats: shops[0],
            subscriptionStats: subscriptions[0],
            recentShops: processedShops,
            expiringSubscriptions: processedSubscriptions,
            admin: req.session.admin
        });
    } catch (err) {
        console.error('Error loading admin dashboard:', err);
        res.status(500).render('admin/error', {
            title: 'Error',
            message: 'Failed to load dashboard: ' + err.message
        });
    }
});

// Shops management
router.get('/shops', requireAdmin, async (req, res) => {
    try {
        const { status, search } = req.query;
        
        let query = `
            SELECT s.*, 
                   sub.plan_name, 
                   sub.expires_at, 
                   sub.status as subscription_status,
                   (SELECT COUNT(*) FROM users u WHERE u.shop_id = s.id AND u.status = 'active') as user_count
            FROM shops s
            LEFT JOIN (
                SELECT * FROM subscriptions 
                WHERE status = 'active'
                ORDER BY created_at DESC
            ) sub ON s.id = sub.shop_id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (status && status !== 'all') {
            query += ' AND s.status = ?';
            params.push(status);
        }
        
        if (search) {
            query += ' AND (s.name LIKE ? OR s.email LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        
        query += ' ORDER BY s.created_at DESC';
        
        const [shops] = await pool.execute(query, params);
        
        // Convert binary UUIDs to string and get product counts
        const shopsWithStats = await Promise.all(shops.map(async (shop) => {
            let productCount = 0;
            try {
                // Instead of shop-specific tables, use the main products table
                const [products] = await pool.execute(
                    'SELECT COUNT(*) as total FROM products WHERE shop_id = ? AND status = "active"',
                    [shop.id]
                );
                productCount = products[0].total;
            } catch (error) {
                console.log('Error getting product count for shop:', error.message);
                productCount = 0;
            }
            
            return {
                ...shop,
                id: binaryToUuid(shop.id),
                product_count: productCount
            };
        }));
        
        res.render('admin/shops', {
            title: 'Manage Shops',
            shops: shopsWithStats,
            currentStatus: status || 'all',
            searchQuery: search || '',
            admin: req.session.admin
        });
    } catch (err) {
        console.error('Error loading shops:', err);
        res.status(500).render('admin/error', {
            title: 'Error',
            message: 'Failed to load shops: ' + err.message
        });
    }
});

// Shop details
router.get('/shops/:id', requireAdmin, async (req, res) => {
    try {
        const shopId = req.params.id;
        const shopIdBinary = uuidToBinary(shopId);
        
        const [shops] = await pool.execute(`
            SELECT s.*, 
                   sub.plan_name, 
                   sub.expires_at, 
                   sub.started_at,
                   sub.price,
                   sub.duration,
                   sub.status as subscription_status
            FROM shops s
            LEFT JOIN subscriptions sub ON s.id = sub.shop_id AND sub.status = 'active'
            WHERE s.id = ?
        `, [shopIdBinary]);
        
        if (shops.length === 0) {
            return res.status(404).render('admin/error', {
                title: 'Error',
                message: 'Shop not found'
            });
        }
        
        // Convert shop ID back to string for display
        const shop = {
            ...shops[0],
            id: shopId
        };
        
        const [users] = await pool.execute(`
            SELECT * FROM users 
            WHERE shop_id = ? 
            ORDER BY created_at DESC
        `, [shopIdBinary]);
        
        // Convert user IDs to string
        const processedUsers = users.map(user => ({
            ...user,
            id: binaryToUuid(user.id),
            shop_id: binaryToUuid(user.shop_id),
            role_id: user.role_id ? binaryToUuid(user.role_id) : null
        }));
        
        const [subscriptions] = await pool.execute(`
            SELECT * FROM subscriptions 
            WHERE shop_id = ? 
            ORDER BY created_at DESC
        `, [shopIdBinary]);
        
        // Convert subscription IDs to string
        const processedSubscriptions = subscriptions.map(sub => ({
            ...sub,
            id: binaryToUuid(sub.id),
            shop_id: binaryToUuid(sub.shop_id)
        }));
        
        // Get shop statistics from main tables
        let shopStats = {};
        try {
            const [products] = await pool.execute(
                'SELECT COUNT(*) as total FROM products WHERE shop_id = ? AND status = "active"',
                [shopIdBinary]
            );
            
            const [bills] = await pool.execute(
                'SELECT COUNT(*) as total, COALESCE(SUM(total_amount), 0) as revenue FROM bills WHERE shop_id = ?',
                [shopIdBinary]
            );
            
            shopStats = {
                totalProducts: products[0].total,
                totalBills: bills[0].total,
                totalRevenue: bills[0].revenue
            };
        } catch (error) {
            console.log('Could not fetch shop statistics:', error.message);
            shopStats = {
                totalProducts: 0,
                totalBills: 0,
                totalRevenue: 0
            };
        }
        
        res.render('admin/shop-details', {
            title: `Shop: ${shop.name}`,
            shop: shop,
            users: processedUsers,
            subscriptions: processedSubscriptions,
            stats: shopStats,
            admin: req.session.admin
        });
    } catch (err) {
        console.error('Error loading shop details:', err);
        res.status(500).render('admin/error', {
            title: 'Error',
            message: 'Failed to load shop details: ' + err.message
        });
    }
});

// Update shop status
router.put('/api/shops/:id/status', requireAdmin, async (req, res) => {
    try {
        const shopId = req.params.id;
        const { status } = req.body;
        const shopIdBinary = uuidToBinary(shopId);
        
        if (!['active', 'inactive', 'suspended'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status'
            });
        }
        
        await pool.execute(
            'UPDATE shops SET status = ?, updated_at = NOW() WHERE id = ?',
            [status, shopIdBinary]
        );
        
        // Log the action
        const actionId = uuidv4();
        await pool.execute(`
            INSERT INTO admin_actions (id, admin_id, shop_id, action_type, details, created_at)
            VALUES (UUID_TO_BIN(?), ?, ?, ?, ?, NOW())
        `, [actionId, req.session.admin.id, shopIdBinary, 'shop_status_update', JSON.stringify({ status })]);
        
        res.json({
            success: true,
            message: `Shop status updated to ${status}`
        });
    } catch (err) {
        console.error('Error updating shop status:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to update shop status: ' + err.message
        });
    }
});

// Extend subscription
router.post('/api/shops/:id/extend-subscription', requireAdmin, async (req, res) => {
    try {
        const shopId = req.params.id;
        const shopIdBinary = uuidToBinary(shopId);
        const { days, reason } = req.body;
        
        if (!days || days <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid number of days'
            });
        }
        
        // Get current subscription
        const [subscriptions] = await pool.execute(`
            SELECT * FROM subscriptions 
            WHERE shop_id = ? AND status = 'active'
            ORDER BY created_at DESC LIMIT 1
        `, [shopIdBinary]);
        
        if (subscriptions.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No active subscription found'
            });
        }
        
        const subscription = subscriptions[0];
        const newExpiryDate = new Date(subscription.expires_at);
        newExpiryDate.setDate(newExpiryDate.getDate() + parseInt(days));
        
        await pool.execute(
            'UPDATE subscriptions SET expires_at = ?, updated_at = NOW() WHERE id = ?',
            [newExpiryDate, subscription.id]
        );
        
        // Log the extension
        const actionId = uuidv4();
        await pool.execute(`
            INSERT INTO admin_actions (id, admin_id, shop_id, action_type, details, created_at)
            VALUES (UUID_TO_BIN(?), ?, ?, ?, ?, NOW())
        `, [actionId, req.session.admin.id, shopIdBinary, 'subscription_extension', 
            JSON.stringify({ 
                days, 
                reason, 
                old_expiry: subscription.expires_at, 
                new_expiry: newExpiryDate 
            })]);
        
        res.json({
            success: true,
            message: `Subscription extended by ${days} days`,
            newExpiryDate: newExpiryDate.toISOString().split('T')[0]
        });
    } catch (err) {
        console.error('Error extending subscription:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to extend subscription: ' + err.message
        });
    }
});

// User management - CORRECTED VERSION
router.get('/users', requireAdmin, async (req, res) => {
    try {
        const { shop_id, status, search } = req.query;
        
        let query = `
            SELECT 
                u.*, 
                s.name as shop_name, 
                s.email as shop_email,
                r.role_name as role_name
            FROM users u
            JOIN shops s ON u.shop_id = s.id
            LEFT JOIN roles r ON u.role_id = r.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (shop_id && shop_id !== 'all') {
            query += ' AND u.shop_id = UUID_TO_BIN(?)';
            params.push(shop_id);
        }
        
        if (status && status !== 'all') {
            query += ' AND u.status = ?';
            params.push(status);
        }
        
        if (search) {
            query += ' AND (u.name LIKE ? OR u.email LIKE ? OR s.name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        
        query += ' ORDER BY u.created_at DESC';
        
        const [users] = await pool.execute(query, params);
        
        // Convert binary UUIDs to string
        const processedUsers = users.map(user => ({
            ...user,
            id: binaryToUuid(user.id),
            shop_id: binaryToUuid(user.shop_id),
            role_id: user.role_id ? binaryToUuid(user.role_id) : null,
            // Add role property for template compatibility
            role: user.role_name ? user.role_name.toLowerCase() : 'other'
        }));
        
        // Get shops for filter
        const [shops] = await pool.execute('SELECT BIN_TO_UUID(id) as id, name FROM shops ORDER BY name');
        
        res.render('admin/users', {
            title: 'Manage Users',
            users: processedUsers,
            shops: shops,
            currentShopId: shop_id || 'all',
            currentStatus: status || 'all',
            searchQuery: search || '',
            admin: req.session.admin
        });
    } catch (err) {
        console.error('Error loading users:', err);
        res.status(500).render('admin/error', {
            title: 'Error',
            message: 'Failed to load users: ' + err.message
        });
    }
});

// Update user status
router.put('/api/users/:id/status', requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const userIdBinary = uuidToBinary(userId);
        const { status } = req.body;
        
        if (!['active', 'inactive'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status'
            });
        }
        
        await pool.execute(
            'UPDATE users SET status = ?, updated_at = NOW() WHERE id = ?',
            [status, userIdBinary]
        );
        
        res.json({
            success: true,
            message: `User status updated to ${status}`
        });
    } catch (err) {
        console.error('Error updating user status:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to update user status: ' + err.message
        });
    }
});

// Feedback management
router.get('/feedback', requireAdmin, async (req, res) => {
    try {
        const { status } = req.query;
        
        let query = `
            SELECT f.*, s.name as shop_name, s.email as shop_email
            FROM feedback f
            JOIN shops s ON f.shop_id = s.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (status && status !== 'all') {
            query += ' AND f.status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY f.created_at DESC';
        
        const [feedback] = await pool.execute(query, params);
        
        // Convert binary UUIDs to string
        const processedFeedback = feedback.map(item => ({
            ...item,
            id: binaryToUuid(item.id),
            shop_id: binaryToUuid(item.shop_id)
        }));
        
        res.render('admin/feedback', {
            title: 'Customer Feedback',
            feedback: processedFeedback,
            currentStatus: status || 'all',
            admin: req.session.admin
        });
    } catch (err) {
        console.error('Error loading feedback:', err);
        res.status(500).render('admin/error', {
            title: 'Error',
            message: 'Failed to load feedback: ' + err.message
        });
    }
});

// Update feedback notes
router.put('/api/feedback/:id/notes', requireAdmin, async (req, res) => {
    try {
        const feedbackId = req.params.id;
        const feedbackIdBinary = uuidToBinary(feedbackId);
        const { notes } = req.body;
        
        await pool.execute(
            'UPDATE feedback SET admin_notes = ?, updated_at = NOW() WHERE id = ?',
            [notes, feedbackIdBinary]
        );
        
        res.json({
            success: true,
            message: 'Notes updated successfully'
        });
    } catch (err) {
        console.error('Error updating feedback notes:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to update notes: ' + err.message
        });
    }
});

// Update feedback status
router.put('/api/feedback/:id/status', requireAdmin, async (req, res) => {
    try {
        const feedbackId = req.params.id;
        const feedbackIdBinary = uuidToBinary(feedbackId);
        const { status } = req.body;
        
        if (!['new', 'read', 'replied', 'resolved'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status'
            });
        }
        
        await pool.execute(
            'UPDATE feedback SET status = ?, updated_at = NOW() WHERE id = ?',
            [status, feedbackIdBinary]
        );
        
        res.json({
            success: true,
            message: `Feedback status updated to ${status}`
        });
    } catch (err) {
        console.error('Error updating feedback status:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to update feedback status: ' + err.message
        });
    }
});

// Subscription Plans Management
router.get('/subscriptions', requireAdmin, async (req, res) => {
    try {
        const [plans] = await pool.execute(`
            SELECT *, BIN_TO_UUID(id) as uuid FROM pricing_plans 
            WHERE status = 'active'
            ORDER BY monthly_price ASC
        `);

        res.render('admin/subscriptions', {
            title: 'Subscription Plans',
            plans: plans,
            admin: req.session.admin
        });
    } catch (err) {
        console.error('Error loading subscription plans:', err);
        res.status(500).render('admin/error', {
            title: 'Error',
            message: 'Failed to load subscription plans: ' + err.message
        });
    }
});

// Add new subscription plan
router.post('/api/subscriptions', requireAdmin, async (req, res) => {
    try {
        const { name, description, monthly_price, quarterly_price, yearly_price, features } = req.body;

        // Validate required fields
        if (!name || !monthly_price || !quarterly_price || !yearly_price) {
            return res.status(400).json({
                success: false,
                message: 'Name and all prices are required'
            });
        }

        // Parse features if provided
        let featuresJson = [];
        if (features) {
            featuresJson = Array.isArray(features) ? features : features.split(',').map(f => f.trim());
        }

        const planId = uuidv4();
        
        await pool.execute(`
            INSERT INTO pricing_plans (id, name, description, monthly_price, quarterly_price, yearly_price, features, status)
            VALUES (UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, 'active')
        `, [planId, name, description || null, monthly_price, quarterly_price, yearly_price, JSON.stringify(featuresJson)]);

        res.json({
            success: true,
            message: 'Subscription plan created successfully'
        });
    } catch (err) {
        console.error('Error creating subscription plan:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to create subscription plan: ' + err.message
        });
    }
});

// Update subscription plan
router.put('/api/subscriptions/:id', requireAdmin, async (req, res) => {
    try {
        const planId = req.params.id;
        const planIdBinary = uuidToBinary(planId);
        const { name, description, monthly_price, quarterly_price, yearly_price, features, status } = req.body;

        // Parse features if provided
        let featuresJson = [];
        if (features) {
            featuresJson = Array.isArray(features) ? features : features.split(',').map(f => f.trim());
        }

        await pool.execute(`
            UPDATE pricing_plans 
            SET name = ?, description = ?, monthly_price = ?, quarterly_price = ?, yearly_price = ?, features = ?, status = ?, updated_at = NOW()
            WHERE id = ?
        `, [name, description || null, monthly_price, quarterly_price, yearly_price, JSON.stringify(featuresJson), status, planIdBinary]);

        res.json({
            success: true,
            message: 'Subscription plan updated successfully'
        });
    } catch (err) {
        console.error('Error updating subscription plan:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to update subscription plan: ' + err.message
        });
    }
});

// Delete subscription plan (soft delete)
router.delete('/api/subscriptions/:id', requireAdmin, async (req, res) => {
    try {
        const planId = req.params.id;
        const planIdBinary = uuidToBinary(planId);

        await pool.execute(
            'UPDATE pricing_plans SET status = "inactive", updated_at = NOW() WHERE id = ?',
            [planIdBinary]
        );

        res.json({
            success: true,
            message: 'Subscription plan deleted successfully'
        });
    } catch (err) {
        console.error('Error deleting subscription plan:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to delete subscription plan: ' + err.message
        });
    }
});

// Get single subscription plan
router.get('/api/subscriptions/:id', requireAdmin, async (req, res) => {
    try {
        const planId = req.params.id;
        const planIdBinary = uuidToBinary(planId);
        
        const [plans] = await pool.execute(`
            SELECT *, BIN_TO_UUID(id) as uuid FROM pricing_plans WHERE id = ?
        `, [planIdBinary]);
        
        if (plans.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Plan not found'
            });
        }
        
        res.json(plans[0]);
    } catch (err) {
        console.error('Error fetching plan:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch plan: ' + err.message
        });
    }
});

// System settings page
router.get('/settings', requireAdmin, async (req, res) => {
    try {
        res.render('admin/settings', {
            title: 'System Settings',
            admin: req.session.admin
        });
    } catch (err) {
        console.error('Error loading settings:', err);
        res.status(500).render('admin/error', {
            title: 'Error',
            message: 'Failed to load settings: ' + err.message
        });
    }
});

module.exports = router;