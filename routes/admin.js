// routes/admin.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const bcrypt = require('bcrypt');
const session = require('express-session');

// Admin credentials (you can change these later)
const ADMIN_CREDENTIALS = {
    username: 'aa',
    password: 'aa' // You'll change this later
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
        req.session.admin = {
            id: 1,
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
        res.redirect('/admin/login');
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
                SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blockedShops
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
            LEFT JOIN subscriptions sub ON s.id = sub.shop_id AND sub.status = 'active'
            ORDER BY s.created_at DESC
            LIMIT 5
        `);

        // Get expiring subscriptions (within 7 days)
        const [expiringSubscriptions] = await pool.execute(`
            SELECT s.name as shop_name, sub.*, DATEDIFF(sub.expires_at, CURDATE()) as days_remaining
            FROM subscriptions sub
            JOIN shops s ON sub.shop_id = s.id
            WHERE sub.status = 'active' 
            AND sub.expires_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
            ORDER BY sub.expires_at ASC
        `);

        res.render('admin/dashboard', {
            title: 'Admin Dashboard',
            stats: shops[0],
            subscriptionStats: subscriptions[0],
            recentShops: recentShops,
            expiringSubscriptions: expiringSubscriptions,
            admin: req.session.admin
        });
    } catch (err) {
        console.error('Error loading admin dashboard:', err);
        res.status(500).render('admin/error', {
            title: 'Error',
            message: 'Failed to load dashboard'
        });
    }
});

// Shops management
// router.get('/shops', requireAdmin, async (req, res) => {
//     try {
//         const { status, search } = req.query;
        
//         let query = `
//             SELECT s.*, 
//                    sub.plan_name, 
//                    sub.expires_at, 
//                    sub.status as subscription_status,
//                    (SELECT COUNT(*) FROM users u WHERE u.shop_id = s.id AND u.status = 'active') as user_count,
//                    (SELECT COUNT(*) FROM shop_${s.id}_products p WHERE p.status = 'active') as product_count
//             FROM shops s
//             LEFT JOIN subscriptions sub ON s.id = sub.shop_id AND sub.status = 'active'
//         `;
        
//         const params = [];
        
//         if (status && status !== 'all') {
//             query += ' WHERE s.status = ?';
//             params.push(status);
//         }
        
//         if (search) {
//             query += params.length ? ' AND' : ' WHERE';
//             query += ' (s.name LIKE ? OR s.email LIKE ?)';
//             params.push(`%${search}%`, `%${search}%`);
//         }
        
//         query += ' ORDER BY s.created_at DESC';
        
//         const [shops] = await pool.execute(query, params);
        
//         res.render('admin/shops', {
//             title: 'Manage Shops',
//             shops: shops,
//             currentStatus: status || 'all',
//             searchQuery: search || '',
//             admin: req.session.admin
//         });
//     } catch (err) {
//         console.error('Error loading shops:', err);
//         res.status(500).render('admin/error', {
//             title: 'Error',
//             message: 'Failed to load shops'
//         });
//     }
// });
// Shops management - FIXED VERSION
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
            LEFT JOIN subscriptions sub ON s.id = sub.shop_id AND sub.status = 'active'
        `;
        
        const params = [];
        
        if (status && status !== 'all') {
            query += ' WHERE s.status = ?';
            params.push(status);
        }
        
        if (search) {
            query += params.length ? ' AND' : ' WHERE';
            query += ' (s.name LIKE ? OR s.email LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        
        query += ' ORDER BY s.created_at DESC';
        
        const [shops] = await pool.execute(query, params);
        
        // For product counts, we'll handle it separately to avoid errors if shop tables don't exist
        const shopsWithStats = await Promise.all(shops.map(async (shop) => {
            try {
                const [products] = await pool.execute(`SELECT COUNT(*) as total FROM shop_${shop.id}_products WHERE status = 'active'`);
                return {
                    ...shop,
                    product_count: products[0].total
                };
            } catch (error) {
                // If shop table doesn't exist or there's an error, return 0
                return {
                    ...shop,
                    product_count: 0
                };
            }
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
        `, [shopId]);
        
        if (shops.length === 0) {
            return res.status(404).render('admin/error', {
                title: 'Error',
                message: 'Shop not found'
            });
        }
        
        const [users] = await pool.execute(`
            SELECT * FROM users 
            WHERE shop_id = ? 
            ORDER BY created_at DESC
        `, [shopId]);
        
        const [subscriptions] = await pool.execute(`
            SELECT * FROM subscriptions 
            WHERE shop_id = ? 
            ORDER BY created_at DESC
        `, [shopId]);
        
        // Try to get shop statistics (might fail if shop tables don't exist)
        let shopStats = {};
        try {
            const [products] = await pool.execute(`SELECT COUNT(*) as total FROM shop_${shopId}_products WHERE status = 'active'`);
            const [bills] = await pool.execute(`SELECT COUNT(*) as total, COALESCE(SUM(total_amount), 0) as revenue FROM shop_${shopId}_bills WHERE status = 'active'`);
            
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
            title: `Shop: ${shops[0].name}`,
            shop: shops[0],
            users: users,
            subscriptions: subscriptions,
            stats: shopStats,
            admin: req.session.admin
        });
    } catch (err) {
        console.error('Error loading shop details:', err);
        res.status(500).render('admin/error', {
            title: 'Error',
            message: 'Failed to load shop details'
        });
    }
});

// Update shop status
router.put('/api/shops/:id/status', requireAdmin, async (req, res) => {
    try {
        const shopId = req.params.id;
        const { status } = req.body;
        
        if (!['active', 'inactive', 'blocked'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status'
            });
        }
        
        await pool.execute(
            'UPDATE shops SET status = ?, updated_at = NOW() WHERE id = ?',
            [status, shopId]
        );
        
        res.json({
            success: true,
            message: `Shop status updated to ${status}`
        });
    } catch (err) {
        console.error('Error updating shop status:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to update shop status'
        });
    }
});

// Extend subscription
router.post('/api/shops/:id/extend-subscription', requireAdmin, async (req, res) => {
    try {
        const shopId = req.params.id;
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
        `, [shopId]);
        
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
        await pool.execute(`
            INSERT INTO admin_actions (admin_id, shop_id, action_type, details, created_at)
            VALUES (?, ?, 'subscription_extension', ?, NOW())
        `, [req.session.admin.id, shopId, JSON.stringify({ days, reason, old_expiry: subscription.expires_at, new_expiry: newExpiryDate })]);
        
        res.json({
            success: true,
            message: `Subscription extended by ${days} days`,
            newExpiryDate: newExpiryDate.toISOString().split('T')[0]
        });
    } catch (err) {
        console.error('Error extending subscription:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to extend subscription'
        });
    }
});

// User management
router.get('/users', requireAdmin, async (req, res) => {
    try {
        const { shop_id, status, search } = req.query;
        
        let query = `
            SELECT u.*, s.name as shop_name, s.email as shop_email
            FROM users u
            JOIN shops s ON u.shop_id = s.id
        `;
        
        const params = [];
        
        if (shop_id) {
            query += ' WHERE u.shop_id = ?';
            params.push(shop_id);
        }
        
        if (status && status !== 'all') {
            query += params.length ? ' AND' : ' WHERE';
            query += ' u.status = ?';
            params.push(status);
        }
        
        if (search) {
            query += params.length ? ' AND' : ' WHERE';
            query += ' (u.name LIKE ? OR u.email LIKE ? OR s.name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        
        query += ' ORDER BY u.created_at DESC';
        
        const [users] = await pool.execute(query, params);
        
        // Get shops for filter
        const [shops] = await pool.execute('SELECT id, name FROM shops ORDER BY name');
        
        res.render('admin/users', {
            title: 'Manage Users',
            users: users,
            shops: shops,
            currentShopId: shop_id || '',
            currentStatus: status || 'all',
            searchQuery: search || '',
            admin: req.session.admin
        });
    } catch (err) {
        console.error('Error loading users:', err);
        res.status(500).render('admin/error', {
            title: 'Error',
            message: 'Failed to load users'
        });
    }
});

// Update user status
router.put('/api/users/:id/status', requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const { status } = req.body;
        
        if (!['active', 'inactive'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status'
            });
        }
        
        await pool.execute(
            'UPDATE users SET status = ?, updated_at = NOW() WHERE id = ?',
            [status, userId]
        );
        
        res.json({
            success: true,
            message: `User status updated to ${status}`
        });
    } catch (err) {
        console.error('Error updating user status:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to update user status'
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
        `;
        
        const params = [];
        
        if (status && status !== 'all') {
            query += ' WHERE f.status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY f.created_at DESC';
        
        const [feedback] = await pool.execute(query, params);
        
        res.render('admin/feedback', {
            title: 'Customer Feedback',
            feedback: feedback,
            currentStatus: status || 'all',
            admin: req.session.admin
        });
    } catch (err) {
        console.error('Error loading feedback:', err);
        res.status(500).render('admin/error', {
            title: 'Error',
            message: 'Failed to load feedback'
        });
    }
});

// Add these routes before module.exports

// API route for feedback notes (add this to your existing admin.js)
router.put('/api/feedback/:id/notes', requireAdmin, async (req, res) => {
    try {
        const feedbackId = req.params.id;
        const { notes } = req.body;
        
        await pool.execute(
            'UPDATE feedback SET admin_notes = ?, updated_at = NOW() WHERE id = ?',
            [notes, feedbackId]
        );
        
        res.json({
            success: true,
            message: 'Notes updated successfully'
        });
    } catch (err) {
        console.error('Error updating feedback notes:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to update notes'
        });
    }
});


// Update feedback status
router.put('/api/feedback/:id/status', requireAdmin, async (req, res) => {
    try {
        const feedbackId = req.params.id;
        const { status } = req.body;
        
        if (!['new', 'read', 'replied', 'resolved'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status'
            });
        }
        
        await pool.execute(
            'UPDATE feedback SET status = ?, updated_at = NOW() WHERE id = ?',
            [status, feedbackId]
        );
        
        res.json({
            success: true,
            message: `Feedback status updated to ${status}`
        });
    } catch (err) {
        console.error('Error updating feedback status:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to update feedback status'
        });
    }
});


// System settings page (you can expand this)
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
            message: 'Failed to load settings'
        });
    }
});

// Subscription Plans Management
router.get('/subscriptions', requireAdmin, async (req, res) => {
    try {
        const [plans] = await pool.execute(`
            SELECT * FROM pricing_plans 
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
            message: 'Failed to load subscription plans'
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

        await pool.execute(`
            INSERT INTO pricing_plans (name, description, monthly_price, quarterly_price, yearly_price, features, status)
            VALUES (?, ?, ?, ?, ?, ?, 'active')
        `, [name, description || null, monthly_price, quarterly_price, yearly_price, JSON.stringify(featuresJson)]);

        res.json({
            success: true,
            message: 'Subscription plan created successfully'
        });
    } catch (err) {
        console.error('Error creating subscription plan:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to create subscription plan'
        });
    }
});

// Update subscription plan
router.put('/api/subscriptions/:id', requireAdmin, async (req, res) => {
    try {
        const planId = req.params.id;
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
        `, [name, description || null, monthly_price, quarterly_price, yearly_price, JSON.stringify(featuresJson), status, planId]);

        res.json({
            success: true,
            message: 'Subscription plan updated successfully'
        });
    } catch (err) {
        console.error('Error updating subscription plan:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to update subscription plan'
        });
    }
});

// Delete subscription plan (soft delete)
router.delete('/api/subscriptions/:id', requireAdmin, async (req, res) => {
    try {
        const planId = req.params.id;

        await pool.execute(
            'UPDATE pricing_plans SET status = "inactive", updated_at = NOW() WHERE id = ?',
            [planId]
        );

        res.json({
            success: true,
            message: 'Subscription plan deleted successfully'
        });
    } catch (err) {
        console.error('Error deleting subscription plan:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to delete subscription plan'
        });
    }
});

// Get single subscription plan
router.get('/api/subscriptions/:id', requireAdmin, async (req, res) => {
    try {
        const planId = req.params.id;
        
        const [plans] = await pool.execute(`
            SELECT * FROM pricing_plans WHERE id = ?
        `, [planId]);
        
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
            message: 'Failed to fetch plan'
        });
    }
});

module.exports = router;