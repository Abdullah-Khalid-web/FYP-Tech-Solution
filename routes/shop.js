// routes/shop.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

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

        if (shops.length === 0) {
            return res.status(404).render('error', {
                title: 'Error',
                message: 'Shop not found'
            });
        }

        const shop = shops[0];
        req.shop = {
            id: req.session.shopId,
            name: shop.name,
            logo: shop.logo ? `/uploads/${shop.logo}` : '/images/default-logo.png',
            currency: shop.currency || 'PKR',
            primary_color: shop.primary_color || '#007bff',
            secondary_color: shop.secondary_color || '#6c757d',
            email: shop.email || '',
            phone: shop.phone || '',
            address: shop.address || ''
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
        res.render('shop_settings/index', {
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

// PUT update shop information - FIXED VERSION
router.put('/api/shop/update', getShopPrefix, upload.single('logo'), async (req, res) => {
    try {
        const shopId = req.session.shopId;
        const { name, email, phone, address, currency } = req.body;

        console.log('Update request received:', { name, email, phone, address, currency });
        console.log('File:', req.file);

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
            console.log('New logo uploaded:', req.file.filename);
            // Delete old logo if exists
            if (currentShop.logo && currentShop.logo !== 'default-logo.png') {
                const oldLogoPath = path.join(__dirname, '../uploads', currentShop.logo);
                if (fs.existsSync(oldLogoPath)) {
                    fs.unlinkSync(oldLogoPath);
                    console.log('Old logo deleted:', currentShop.logo);
                }
            }
            logo = req.file.filename;
        }

        // Handle logo removal
        if (req.body.remove_logo === 'true' && currentShop.logo) {
            console.log('Removing logo');
            const logoPath = path.join(__dirname, '../uploads', currentShop.logo);
            if (fs.existsSync(logoPath)) {
                fs.unlinkSync(logoPath);
            }
            logo = null;
        }

        // Build update query dynamically based on provided fields
        const updateFields = [];
        const updateValues = [];

        if (name) {
            updateFields.push('name = ?');
            updateValues.push(name);
        }
        if (email) {
            updateFields.push('email = ?');
            updateValues.push(email);
        }
        if (phone !== undefined) {
            updateFields.push('phone = ?');
            updateValues.push(phone || null);
        }
        if (address !== undefined) {
            updateFields.push('address = ?');
            updateValues.push(address || null);
        }
        if (currency) {
            updateFields.push('currency = ?');
            updateValues.push(currency);
        }
        if (logo !== undefined) {
            updateFields.push('logo = ?');
            updateValues.push(logo);
        }

        // Always update the updated_at timestamp
        updateFields.push('updated_at = NOW()');

        // Add shopId to values
        updateValues.push(shopId);

        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No fields to update'
            });
        }

        const query = `UPDATE shops SET ${updateFields.join(', ')} WHERE id = ?`;
        
        console.log('Executing query:', query);
        console.log('With values:', updateValues);

        await pool.execute(query, updateValues);

        res.json({
            success: true,
            message: 'Shop information updated successfully'
        });
    } catch (err) {
        console.error('Error updating shop:', err);
        
        // Delete uploaded file if there was an error
        if (req.file) {
            fs.unlink(req.file.path, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting uploaded file:', unlinkErr);
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Failed to update shop information: ' + err.message
        });
    }
});

// PUT update shop appearance - FIXED VERSION
router.put('/api/shop/appearance', getShopPrefix, async (req, res) => {
    try {
        const shopId = req.session.shopId;
        const { primary_color, secondary_color } = req.body;

        console.log('Appearance update:', { primary_color, secondary_color });

        if (!primary_color && !secondary_color) {
            return res.status(400).json({
                success: false,
                message: 'At least one color must be provided'
            });
        }

        const updateFields = [];
        const updateValues = [];

        if (primary_color) {
            updateFields.push('primary_color = ?');
            updateValues.push(primary_color);
        }
        if (secondary_color) {
            updateFields.push('secondary_color = ?');
            updateValues.push(secondary_color);
        }

        updateFields.push('updated_at = NOW()');
        updateValues.push(shopId);

        const query = `UPDATE shops SET ${updateFields.join(', ')} WHERE id = ?`;
        
        await pool.execute(query, updateValues);

        res.json({
            success: true,
            message: 'Appearance settings updated successfully'
        });
    } catch (err) {
        console.error('Error updating appearance:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to update appearance settings: ' + err.message
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
            `SELECT COUNT(*) as total FROM ${tablePrefix}products WHERE status = 'active'`
        );

        // Get total sales
        const [sales] = await pool.execute(
            `SELECT COALESCE(SUM(total_amount), 0) as total FROM ${tablePrefix}bills WHERE status = 'active'`
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
            `SELECT s.*, p.name as plan_name, p.monthly_price, p.quarterly_price, p.yearly_price
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
        
        // Calculate price based on duration
        let price = 0;
        switch(subscription.duration) {
            case 'monthly':
                price = subscription.monthly_price || subscription.price;
                break;
            case 'quarterly':
                price = subscription.quarterly_price || subscription.price;
                break;
            case 'yearly':
                price = subscription.yearly_price || subscription.price;
                break;
            default:
                price = subscription.price;
        }

        res.json({
            success: true,
            subscription: {
                plan: subscription.plan_name,
                price: price,
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
             WHERE shop_id = ? AND status = 'active'
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
            tempPassword: tempPassword
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

// DELETE user (soft delete - update status to inactive)
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

        // Soft delete - update status to inactive
        await pool.execute(
            'UPDATE users SET status = "inactive", updated_at = NOW() WHERE id = ? AND shop_id = ?',
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

        // Create backup record
        const [result] = await pool.execute(
            'INSERT INTO backups (shop_id, filename, status, created_at) VALUES (?, ?, "completed", NOW())',
            [shopId, `backup_${shopId}_${Date.now()}.sql`]
        );

        res.json({
            success: true,
            message: 'Backup created successfully',
            backupId: result.insertId,
            downloadUrl: `/api/shop/backup/${result.insertId}/download`
        });
    } catch (err) {
        console.error('Error creating backup:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to create backup'
        });
    }
});

// DELETE shop data (soft reset - mark as inactive)
router.delete('/api/shop/reset', getShopPrefix, async (req, res) => {
    try {
        const shopId = req.session.shopId;
        const tablePrefix = req.tablePrefix;

        const confirmation = req.body.confirmation;
        if (confirmation !== 'DELETE_ALL_DATA') {
            return res.status(400).json({
                success: false,
                message: 'Confirmation required. Type DELETE_ALL_DATA to confirm.'
            });
        }

        // Soft reset - mark all records as inactive instead of deleting
        const tables = ['products', 'bills', 'bill_items', 'user_salaries', 'user_loans', 'active_log_user'];
        
        for (const table of tables) {
            await pool.execute(`UPDATE ${tablePrefix}${table} SET status = 'inactive' WHERE status = 'active'`);
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

// DELETE shop (soft delete)
router.delete('/api/shop', getShopPrefix, async (req, res) => {
    try {
        const shopId = req.session.shopId;

        if (!confirm('This will permanently mark your shop as inactive. Are you absolutely sure?')) {
            return res.status(400).json({
                success: false,
                message: 'Shop deletion cancelled'
            });
        }

        // Soft delete - mark shop as inactive
        await pool.execute(
            'UPDATE shops SET status = "inactive", updated_at = NOW() WHERE id = ?',
            [shopId]
        );

        // Also mark subscription as cancelled
        await pool.execute(
            'UPDATE subscriptions SET status = "cancelled", updated_at = NOW() WHERE shop_id = ?',
            [shopId]
        );

        res.json({
            success: true,
            message: 'Shop has been marked as inactive'
        });
    } catch (err) {
        console.error('Error deleting shop:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to delete shop'
        });
    }
});

module.exports = router;