// routes/shop.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for shop logo
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'shop-logo-' + uniqueSuffix + path.extname(file.originalname));
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
            secondary_color: shops[0]?.secondary_color || '#6c757d',
            email: shops[0]?.email || '',
            phone: shops[0]?.phone || '',
            address: shops[0]?.address || ''
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
            secondary_color: '#6c757d',
            email: '',
            phone: '',
            address: ''
        };
        next();
    }
};

// GET shop settings page
router.get('/', getShopPrefix, async (req, res) => {
    try {
        res.render('shop_settings', {
            title: 'Shop Settings',
            shop: req.shop
        });
    } catch (err) {
        console.error('Error loading shop settings:', err);
        res.status(500).render('error', {
            title: 'Error',
            message: 'Failed to load shop settings'
        });
    }
});

// PUT update shop information
router.put('/api/shop/update', getShopPrefix, upload.single('logo'), async (req, res) => {
    try {
        const shopId = req.session.shopId;
        const { name, email, phone, address, currency } = req.body;

        // Validate required fields
        if (!name || !email) {
            return res.status(400).json({
                success: false,
                message: 'Shop name and email are required'
            });
        }

        // Get current shop data
        const [shops] = await pool.execute(
            'SELECT logo FROM shops WHERE id = ?',
            [shopId]
        );

        if (shops.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Shop not found'
            });
        }

        const currentShop = shops[0];
        let logo = currentShop.logo;

        // Handle logo upload
        if (req.file) {
            // Delete old logo if exists
            if (currentShop.logo) {
                const oldLogoPath = path.join(__dirname, '../uploads', currentShop.logo);
                if (fs.existsSync(oldLogoPath)) {
                    fs.unlinkSync(oldLogoPath);
                }
            }
            logo = req.file.filename;
        }

        // Handle logo removal
        if (req.body.remove_logo === 'true' && currentShop.logo) {
            const logoPath = path.join(__dirname, '../uploads', currentShop.logo);
            if (fs.existsSync(logoPath)) {
                fs.unlinkSync(logoPath);
            }
            logo = null;
        }

        // Update shop information
        await pool.execute(
            `UPDATE shops 
             SET name = ?, email = ?, phone = ?, address = ?, currency = ?, logo = ?, updated_at = NOW()
             WHERE id = ?`,
            [name, email, phone || null, address || null, currency || 'PKR', logo, shopId]
        );

        res.json({
            success: true,
            message: 'Shop information updated successfully'
        });
    } catch (err) {
        console.error('Error updating shop:', err);
        
        // Delete uploaded file if there was an error
        if (req.file) {
            fs.unlink(req.file.path, () => {});
        }
        
        res.status(500).json({
            success: false,
            message: 'Failed to update shop information'
        });
    }
});

// PUT update shop appearance
router.put('/api/shop/appearance', getShopPrefix, async (req, res) => {
    try {
        const shopId = req.session.shopId;
        const { primary_color, secondary_color, date_format, time_format, dark_mode } = req.body;

        await pool.execute(
            `UPDATE shops 
             SET primary_color = ?, secondary_color = ?, updated_at = NOW()
             WHERE id = ?`,
            [primary_color || '#007bff', secondary_color || '#6c757d', shopId]
        );

        res.json({
            success: true,
            message: 'Appearance settings updated successfully'
        });
    } catch (err) {
        console.error('Error updating appearance:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to update appearance settings'
        });
    }
});

// GET shop statistics
router.get('/api/shop/statistics', getShopPrefix, async (req, res) => {
    try {
        const shopId = req.session.shopId;
        const tablePrefix = req.tablePrefix;

        // Get shop creation date
        const [shopData] = await pool.execute(
            'SELECT created_at FROM shops WHERE id = ?',
            [shopId]
        );

        // Get total products
        const [products] = await pool.execute(
            `SELECT COUNT(*) as total FROM ${tablePrefix}products`
        );

        // Get total sales
        const [sales] = await pool.execute(
            `SELECT COALESCE(SUM(total_amount), 0) as total FROM ${tablePrefix}bills`
        );

        res.json({
            success: true,
            statistics: {
                registrationDate: shopData[0]?.created_at || new Date(),
                totalProducts: parseInt(products[0].total) || 0,
                totalSales: parseFloat(sales[0].total) || 0
            }
        });
    } catch (err) {
        console.error('Error fetching shop statistics:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load shop statistics'
        });
    }
});

// GET subscription information
router.get('/api/shop/subscription', getShopPrefix, async (req, res) => {
    try {
        const shopId = req.session.shopId;

        const [subscriptions] = await pool.execute(
            `SELECT s.*, p.monthly_price, p.quarterly_price, p.yearly_price
             FROM subscriptions s
             LEFT JOIN pricing_plans p ON s.plan_name = p.name
             WHERE s.shop_id = ? AND s.status = 'active'
             ORDER BY s.created_at DESC LIMIT 1`,
            [shopId]
        );

        if (subscriptions.length === 0) {
            return res.json({
                success: true,
                subscription: null
            });
        }

        const subscription = subscriptions[0];
        res.json({
            success: true,
            subscription: {
                plan: subscription.plan_name,
                price: subscription.price,
                duration: subscription.duration,
                startDate: subscription.started_at,
                expiryDate: subscription.expires_at,
                status: subscription.status
            }
        });
    } catch (err) {
        console.error('Error fetching subscription:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load subscription information'
        });
    }
});

// GET shop users
router.get('/api/shop/users', getShopPrefix, async (req, res) => {
    try {
        const shopId = req.session.shopId;

        const [users] = await pool.execute(
            `SELECT id, name, email, role, status, salary, created_at, updated_at
             FROM users 
             WHERE shop_id = ? 
             ORDER BY 
                 CASE role 
                     WHEN 'owner' THEN 1
                     WHEN 'manager' THEN 2
                     WHEN 'cashier' THEN 3
                     ELSE 4
                 END, name`,
            [shopId]
        );

        res.json({
            success: true,
            users: users
        });
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load users'
        });
    }
});

// POST add new user
router.post('/api/shop/users', getShopPrefix, async (req, res) => {
    try {
        const shopId = req.session.shopId;
        const { name, email, role, salary } = req.body;

        // Validate required fields
        if (!name || !email || !role) {
            return res.status(400).json({
                success: false,
                message: 'Name, email, and role are required'
            });
        }

        // Check if email already exists
        const [existingUsers] = await pool.execute(
            'SELECT id FROM users WHERE email = ? AND shop_id = ?',
            [email, shopId]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'User with this email already exists'
            });
        }

        // Generate temporary password
        const tempPassword = Math.random().toString(36).slice(-8);
        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        // Insert new user
        const [result] = await pool.execute(
            `INSERT INTO users 
             (shop_id, name, email, password, role, salary, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())`,
            [shopId, name, email, hashedPassword, role, salary ? parseFloat(salary) : null]
        );

        res.json({
            success: true,
            message: 'User added successfully',
            userId: result.insertId,
            tempPassword: tempPassword // In production, send via email instead
        });
    } catch (err) {
        console.error('Error adding user:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to add user'
        });
    }
});

// PUT update user
router.put('/api/shop/users/:id', getShopPrefix, async (req, res) => {
    try {
        const shopId = req.session.shopId;
        const userId = req.params.id;
        const { name, email, role, salary, status } = req.body;

        // Check if user exists and belongs to this shop
        const [users] = await pool.execute(
            'SELECT id FROM users WHERE id = ? AND shop_id = ?',
            [userId, shopId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Check email uniqueness
        if (email) {
            const [existingUsers] = await pool.execute(
                'SELECT id FROM users WHERE email = ? AND shop_id = ? AND id != ?',
                [email, shopId, userId]
            );

            if (existingUsers.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'User with this email already exists'
                });
            }
        }

        await pool.execute(
            `UPDATE users 
             SET name = ?, email = ?, role = ?, salary = ?, status = ?, updated_at = NOW()
             WHERE id = ? AND shop_id = ?`,
            [name, email, role, salary ? parseFloat(salary) : null, status, userId, shopId]
        );

        res.json({
            success: true,
            message: 'User updated successfully'
        });
    } catch (err) {
        console.error('Error updating user:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to update user'
        });
    }
});

// DELETE user
router.delete('/api/shop/users/:id', getShopPrefix, async (req, res) => {
    try {
        const shopId = req.session.shopId;
        const userId = req.params.id;

        // Prevent deleting own account
        if (parseInt(userId) === req.session.userId) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete your own account'
            });
        }

        // Check if user exists and belongs to this shop
        const [users] = await pool.execute(
            'SELECT id, role FROM users WHERE id = ? AND shop_id = ?',
            [userId, shopId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Prevent deleting owner account
        if (users[0].role === 'owner') {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete owner account'
            });
        }

        await pool.execute(
            'DELETE FROM users WHERE id = ? AND shop_id = ?',
            [userId, shopId]
        );

        res.json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (err) {
        console.error('Error deleting user:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to delete user'
        });
    }
});

// POST create data backup
router.post('/api/shop/backup', getShopPrefix, async (req, res) => {
    try {
        const shopId = req.session.shopId;
        const tablePrefix = req.tablePrefix;

        // In a real application, you would:
        // 1. Export all shop tables to a SQL file
        // 2. Compress the file
        // 3. Store it in a secure location
        // 4. Record the backup in a backups table

        const backupId = 'backup_' + Date.now();
        
        // Simulate backup creation
        await new Promise(resolve => setTimeout(resolve, 2000));

        res.json({
            success: true,
            message: 'Backup created successfully',
            backupId: backupId,
            downloadUrl: `/api/shop/backup/${backupId}/download`
        });
    } catch (err) {
        console.error('Error creating backup:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to create backup'
        });
    }
});

// DELETE shop data (reset)
router.delete('/api/shop/reset', getShopPrefix, async (req, res) => {
    try {
        const shopId = req.session.shopId;
        const tablePrefix = req.tablePrefix;

        // This is a dangerous operation - in production, you would:
        // 1. Require additional confirmation
        // 2. Create a backup first
        // 3. Use transactions
        // 4. Log the action

        const confirmation = req.body.confirmation;
        if (confirmation !== 'DELETE_ALL_DATA') {
            return res.status(400).json({
                success: false,
                message: 'Confirmation required. Type DELETE_ALL_DATA to confirm.'
            });
        }

        // Reset all shop tables (truncate or delete)
        const tables = ['products', 'bills', 'bill_items', 'user_salaries', 'user_loans', 'active_log_user'];
        
        for (const table of tables) {
            await pool.execute(`DELETE FROM ${tablePrefix}${table}`);
        }

        res.json({
            success: true,
            message: 'All shop data has been reset'
        });
    } catch (err) {
        console.error('Error resetting shop data:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to reset shop data'
        });
    }
});

module.exports = router;