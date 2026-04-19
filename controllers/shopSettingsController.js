const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Middleware to get shop data
const getShopData = async (req, res, next) => {
    if (!req.session.shopId) {
        return res.status(403).json({ success: false, message: 'Shop not identified' });
    }

    try {
        const [shops] = await pool.execute(
            'SELECT * FROM shops WHERE id = UUID_TO_BIN(?)',
            [req.session.shopId]
        );

        req.shop = {
            id: req.session.shopId,
            name: shops[0]?.name || 'My Shop',
            email: shops[0]?.email || '',
            phone: shops[0]?.phone || '',
            address: shops[0]?.address || '',
            logo: shops[0]?.logo ? `/uploads/${shops[0].logo}` : '/images/default-logo.png',
            plan: shops[0]?.plan || 'Free',
            currency: shops[0]?.currency || 'PKR',
            primary_color: shops[0]?.primary_color || '#4e73df',
            secondary_color: shops[0]?.secondary_color || '#858796',
            status: shops[0]?.status || 'active'
        };

        next();
    } catch (err) {
        console.error('Error fetching shop details:', err);
        req.shop = {
            id: req.session.shopId,
            name: 'My Shop',
            logo: '/images/default-shop.png',
            currency: 'PKR',
            primary_color: '#4e73df',
            secondary_color: '#858796',
            status: 'active'
        };
        next();
    }
};

// Configure multer for shop logo upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../public/uploads/shop_logos');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'logo-' + req.session.shopId + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// Helper functions for UUID
async function uuidToBin(uuid) {
    const [rows] = await pool.execute('SELECT UUID_TO_BIN(?) as bin', [uuid]);
    return rows[0].bin;
}

async function binToUuid(bin) {
    const [rows] = await pool.execute('SELECT BIN_TO_UUID(?) as uuid', [bin]);
    return rows[0].uuid;
}

// GET /shop-settings - Shop Settings Page
router.get('/', getShopData, async (req, res) => {
    try {
        // Debug: Check session data
        console.log('Shop Settings - Session Data:', {
            userId: req.session.userId,
            role: req.session.role,
            shopId: req.session.shopId,
            shopName: req.session.shopName
        });

        if (!req.session.userId) {
            console.log('No user ID in session, redirecting to login');
            return res.redirect('/login');
        }

        // Allow both owners and admins (temporarily remove strict check for testing)
        // if (!['owner', 'admin'].includes(req.session.role)) {
        //     console.log(`User role '${req.session.role}' not allowed. Redirecting to dashboard`);
        //     return res.redirect('/dashboard');
        // }

        const shopIdBin = await uuidToBin(req.session.shopId);

        // Get shop details
        const [shops] = await pool.execute(
            'SELECT * FROM shops WHERE id = ?',
            [shopIdBin]
        );

        if (shops.length === 0) {
            return res.status(404).render('error', {
                title: 'Shop Not Found',
                error: 'Shop not found'
            });
        }

        const shop = shops[0];

        // Get active subscription
        const [activeSubscriptions] = await pool.execute(
            `SELECT *, BIN_TO_UUID(id) as subscription_id 
             FROM subscriptions 
             WHERE shop_id = ? AND status = 'active' 
             ORDER BY expires_at DESC 
             LIMIT 1`,
            [shopIdBin]
        );

        // Get subscription history
        const [subscriptionHistory] = await pool.execute(
            `SELECT *, BIN_TO_UUID(id) as subscription_id 
             FROM subscriptions 
             WHERE shop_id = ? 
             ORDER BY started_at DESC 
             LIMIT 10`,
            [shopIdBin]
        );

        // Get available pricing plans
        const [pricingPlans] = await pool.execute(
            `SELECT *, BIN_TO_UUID(id) as plan_id 
             FROM pricing_plans 
             WHERE status = 'active' 
             ORDER BY monthly_price`,
            []
        );

        // Get shop statistics
        const [stats] = await pool.execute(
            `SELECT 
                (SELECT COUNT(*) FROM users WHERE shop_id = ? AND status = 'active') as total_users,
                (SELECT COUNT(*) FROM products WHERE shop_id = ?) as total_products,
                (SELECT COUNT(*) FROM customers WHERE shop_id = ?) as total_customers,
                (SELECT COUNT(*) FROM bills WHERE shop_id = ? AND DATE(created_at) = CURDATE()) as today_sales`,
            [shopIdBin, shopIdBin, shopIdBin, shopIdBin]
        );

        // Get recent admin actions
        const [recentActions] = await pool.execute(
            `SELECT action_type, details, created_at 
             FROM admin_actions 
             WHERE shop_id = ? 
             ORDER BY created_at DESC 
             LIMIT 5`,
            [shopIdBin]
        );

        // Debug: Check what data is being passed to template
        console.log('Rendering shop_settings with data:', {
            shopName: shop.name,
            hasLogo: !!shop.logo,
            activeSubscription: activeSubscriptions.length,
            pricingPlansCount: pricingPlans.length
        });

        res.render('shop_settings', {
            title: 'Shop Settings',
            shop: {
                id: req.session.shopId,
                name: shop.name,
                email: shop.email,
                phone: shop.phone,
                address: shop.address,
                logo: shop.logo ? `/uploads/shop_logos/${shop.logo}` : '/images/default-shop.png',
                plan: shop.plan,
                currency: shop.currency,
                primary_color: shop.primary_color,
                secondary_color: shop.secondary_color,
                status: shop.status,
                created_at: shop.created_at
            },
            activeSubscription: activeSubscriptions[0] || null,
            subscriptionHistory: subscriptionHistory || [],
            pricingPlans: pricingPlans || [],
            stats: stats[0] || {},
            recentActions: recentActions || [],
            success: req.query.success,
            error: req.query.error
        });

    } catch (error) {
        console.error('Error loading shop settings:', error);
        res.status(500).render('error', {
            title: 'Server Error',
            error: 'Failed to load shop settings: ' + error.message
        });
    }
});

// POST /shop-settings/update - Update Shop Information
router.post('/update', getShopData, upload.single('logo'), async (req, res) => {
    const { name, email, phone, address, currency, primary_color, secondary_color } = req.body;

    let connection;
    try {
        if (!req.session.userId) {
            return res.redirect('/login');
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        const shopIdBin = await uuidToBin(req.session.shopId);

        // Check if email already exists for other shops
        if (email) {
            const [existingShops] = await connection.execute(
                'SELECT id FROM shops WHERE email = ? AND id != ?',
                [email, shopIdBin]
            );

            if (existingShops.length > 0) {
                return res.redirect('/shop-settings?error=Email already registered with another shop');
            }
        }

        // Prepare update fields
        const updateFields = [
            'name = ?',
            'email = ?',
            'phone = ?',
            'address = ?',
            'currency = ?',
            'primary_color = ?',
            'secondary_color = ?',
            'updated_at = NOW()'
        ];
        const updateValues = [
            name,
            email || null,
            phone || null,
            address || null,
            currency || 'PKR',
            primary_color || '#4e73df',
            secondary_color || '#858796'
        ];

        // Handle logo upload
        if (req.file) {
            updateFields.push('logo = ?');
            updateValues.push(req.file.filename);

            // Delete old logo if exists
            const [oldShop] = await connection.execute(
                'SELECT logo FROM shops WHERE id = ?',
                [shopIdBin]
            );

            if (oldShop[0]?.logo) {
                const oldPath = path.join(__dirname, '../public/uploads/shop_logos', oldShop[0].logo);
                if (fs.existsSync(oldPath)) {
                    fs.unlinkSync(oldPath);
                }
            }
        }

        updateValues.push(shopIdBin);

        // Update shop
        await connection.execute(
            `UPDATE shops SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );

        // Log activity
        const actionIdBin = await uuidToBin(uuidv4());
        await connection.execute(
            `INSERT INTO admin_actions (id, admin_id, shop_id, action_type, details) 
             VALUES (?, ?, ?, 'shop_update', ?)`,
            [
                actionIdBin,
                await uuidToBin(req.session.userId),
                shopIdBin,
                JSON.stringify({ action: 'Updated shop settings' })
            ]
        );

        await connection.commit();
        connection.release();

        // Update session shop name
        req.session.shopName = name;

        res.redirect('/shop_setting?success=Shop information updated successfully');

    } catch (error) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }

        if (req.file) {
            fs.unlink(req.file.path, () => {});
        }

        console.error('Error updating shop:', error);
        res.redirect('/shop_setting?error=Failed to update shop information: ' + error.message);
    }
});

// POST /shop-settings/subscribe - Create new subscription
router.post('/subscribe', getShopData, async (req, res) => {
    const { plan_id, duration, payment_method, auto_renew } = req.body;

    let connection;
    try {
        if (!req.session.userId) {
            return res.redirect('/login');
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        const shopIdBin = await uuidToBin(req.session.shopId);
        const userIdBin = await uuidToBin(req.session.userId);
        const planIdBin = await uuidToBin(plan_id);

        // Get plan details
        const [plans] = await connection.execute(
            `SELECT * FROM pricing_plans WHERE id = ?`,
            [planIdBin]
        );

        if (plans.length === 0) {
            throw new Error('Selected plan not found');
        }

        const plan = plans[0];

        // Calculate price based on duration
        let price;
        switch (duration) {
            case 'monthly':
                price = plan.monthly_price;
                break;
            case 'quarterly':
                price = plan.quarterly_price;
                break;
            case 'yearly':
                price = plan.yearly_price;
                break;
            default:
                price = plan.monthly_price;
        }

        // Get current active subscription to determine start date
        const [activeSubs] = await connection.execute(
            `SELECT expires_at FROM subscriptions 
             WHERE shop_id = ? AND status = 'active' 
             ORDER BY expires_at DESC LIMIT 1`,
            [shopIdBin]
        );

        let startDate = new Date();
        if (activeSubs.length > 0 && activeSubs[0].expires_at > new Date()) {
            // Start new subscription when current one expires
            startDate = new Date(activeSubs[0].expires_at);
            startDate.setDate(startDate.getDate() + 1); // Start next day
        }

        // Calculate expiry date
        let expiresAt = new Date(startDate);
        switch (duration) {
            case 'monthly':
                expiresAt.setMonth(expiresAt.getMonth() + 1);
                break;
            case 'quarterly':
                expiresAt.setMonth(expiresAt.getMonth() + 3);
                break;
            case 'yearly':
                expiresAt.setFullYear(expiresAt.getFullYear() + 1);
                break;
        }

        // Create new subscription
        const subscriptionIdBin = await uuidToBin(uuidv4());
        await connection.execute(
            `INSERT INTO subscriptions (id, shop_id, plan_name, price, duration, 
             started_at, expires_at, status, payment_method, auto_renew) 
             VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
            [
                subscriptionIdBin,
                shopIdBin,
                plan.name,
                price,
                duration,
                startDate,
                expiresAt,
                payment_method || 'manual',
                auto_renew === 'on' ? 1 : 0
            ]
        );

        // Update shop plan
        await connection.execute(
            `UPDATE shops SET plan = ?, updated_at = NOW() WHERE id = ?`,
            [plan.name, shopIdBin]
        );

        // Log activity
        const actionIdBin = await uuidToBin(uuidv4());
        await connection.execute(
            `INSERT INTO admin_actions (id, admin_id, shop_id, action_type, details) 
             VALUES (?, ?, ?, 'subscription_update', ?)`,
            [
                actionIdBin,
                userIdBin,
                shopIdBin,
                JSON.stringify({ 
                    action: `Subscribed to ${plan.name} (${duration})`,
                    amount: price,
                    expires_at: expiresAt
                })
            ]
        );

        await connection.commit();
        connection.release();

        res.redirect('/shop_setting?success=Subscription activated successfully');

    } catch (error) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }

        console.error('Error creating subscription:', error);
        res.redirect('/shop_setting?error=Failed to process subscription: ' + error.message);
    }
});

// POST /shop-settings/cancel-subscription - Cancel subscription
router.post('/cancel-subscription', getShopData, async (req, res) => {
    let connection;
    try {
        if (!req.session.userId) {
            return res.redirect('/login');
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        const shopIdBin = await uuidToBin(req.session.shopId);
        const userIdBin = await uuidToBin(req.session.userId);

        // Cancel active subscription
        await connection.execute(
            `UPDATE subscriptions 
             SET status = 'cancelled', updated_at = NOW() 
             WHERE shop_id = ? AND status = 'active'`,
            [shopIdBin]
        );

        // Update shop to free plan
        await connection.execute(
            `UPDATE shops SET plan = 'Free', updated_at = NOW() WHERE id = ?`,
            [shopIdBin]
        );

        // Log activity
        const actionIdBin = await uuidToBin(uuidv4());
        await connection.execute(
            `INSERT INTO admin_actions (id, admin_id, shop_id, action_type, details) 
             VALUES (?, ?, ?, 'subscription_cancelled', ?)`,
            [
                actionIdBin,
                userIdBin,
                shopIdBin,
                JSON.stringify({ action: 'Cancelled subscription' })
            ]
        );

        await connection.commit();
        connection.release();

        res.redirect('/shop_setting?success=Subscription cancelled successfully');

    } catch (error) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }

        console.error('Error cancelling subscription:', error);
        res.redirect('/shop_setting?error=Failed to cancel subscription: ' + error.message);
    }
});

// POST /shop-settings/update-status - Update shop status (activate/deactivate)
router.post('/update-status', getShopData, async (req, res) => {
    const { status, reason } = req.body;

    if (!['active', 'inactive', 'suspended'].includes(status)) {
        return res.redirect('/shop-settings?error=Invalid status');
    }

    let connection;
    try {
        if (!req.session.userId) {
            return res.redirect('/login');
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        const shopIdBin = await uuidToBin(req.session.shopId);
        const userIdBin = await uuidToBin(req.session.userId);

        // Update shop status
        await connection.execute(
            `UPDATE shops SET status = ?, updated_at = NOW() WHERE id = ?`,
            [status, shopIdBin]
        );

        // If deactivating, also deactivate all users
        if (status === 'inactive' || status === 'suspended') {
            await connection.execute(
                `UPDATE users SET status = 'inactive', updated_at = NOW() 
                 WHERE shop_id = ? AND id != ?`,
                [shopIdBin, userIdBin]
            );
        }

        // Log activity
        const actionIdBin = await uuidToBin(uuidv4());
        await connection.execute(
            `INSERT INTO admin_actions (id, admin_id, shop_id, action_type, details) 
             VALUES (?, ?, ?, 'shop_status_update', ?)`,
            [
                actionIdBin,
                userIdBin,
                shopIdBin,
                JSON.stringify({ 
                    action: `Shop status changed to ${status}`,
                    reason: reason || 'No reason provided'
                })
            ]
        );

        await connection.commit();
        connection.release();

        const message = status === 'active' 
            ? 'Shop activated successfully' 
            : 'Shop deactivated successfully';

        res.redirect('/shop_setting?success=' + message);

    } catch (error) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }

        console.error('Error updating shop status:', error);
        res.redirect('/shop_setting?error=Failed to update shop status: ' + error.message);
    }
});

// POST /shop-settings/backup - Create shop backup
router.post('/backup', getShopData, async (req, res) => {
    let connection;
    try {
        if (!req.session.userId) {
            return res.redirect('/login');
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        const shopIdBin = await uuidToBin(req.session.shopId);
        const userIdBin = await uuidToBin(req.session.userId);

        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `backup-${req.session.shopId}-${timestamp}.sql`;

        // Create backup record
        const backupIdBin = await uuidToBin(uuidv4());
        await connection.execute(
            `INSERT INTO backups (id, shop_id, filename, status) 
             VALUES (?, ?, ?, 'pending')`,
            [backupIdBin, shopIdBin, filename]
        );

        // Log activity
        const actionIdBin = await uuidToBin(uuidv4());
        await connection.execute(
            `INSERT INTO admin_actions (id, admin_id, shop_id, action_type, details) 
             VALUES (?, ?, ?, 'backup_created', ?)`,
            [
                actionIdBin,
                userIdBin,
                shopIdBin,
                JSON.stringify({ action: 'Backup requested', filename: filename })
            ]
        );

        await connection.commit();
        connection.release();

        res.redirect('/shop_setting?success=Backup request submitted successfully');

    } catch (error) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }

        console.error('Error creating backup:', error);
        res.redirect('/shop_setting?error=Failed to create backup: ' + error.message);
    }
});

// GET /shop-settings/export-data - Export shop data
router.get('/export-data', getShopData, async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.redirect('/login');
        }

        const shopIdBin = await uuidToBin(req.session.shopId);

        // Get shop data
        const [shopData] = await pool.execute(
            'SELECT * FROM shops WHERE id = ?',
            [shopIdBin]
        );

        // Get users
        const [users] = await pool.execute(
            'SELECT * FROM users WHERE shop_id = ?',
            [shopIdBin]
        );

        // Get products
        const [products] = await pool.execute(
            'SELECT * FROM products WHERE shop_id = ?',
            [shopIdBin]
        );

        // Get subscriptions
        const [subscriptions] = await pool.execute(
            'SELECT * FROM subscriptions WHERE shop_id = ?',
            [shopIdBin]
        );

        // Prepare data for export
        const exportData = {
            shop: shopData[0],
            users: users,
            products: products,
            subscriptions: subscriptions,
            export_date: new Date().toISOString()
        };

        // Set headers for JSON download
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=shop-data-${req.session.shopId}.json`);

        res.send(JSON.stringify(exportData, null, 2));

    } catch (error) {
        console.error('Error exporting data:', error);
        res.redirect('/shop_setting?error=Failed to export data: ' + error.message);
    }
});

// Debug route to check session
router.get('/debug', (req, res) => {
    res.json({
        userId: req.session.userId,
        role: req.session.role,
        shopId: req.session.shopId,
        shopName: req.session.shopName,
        sessionID: req.sessionID,
        session: req.session
    });
});

module.exports = router;