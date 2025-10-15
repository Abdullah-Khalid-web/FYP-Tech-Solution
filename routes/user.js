// routes/user_profile.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const bcrypt = require('bcryptjs');

// Middleware to get shop-specific table prefix and shop meta
const getShopPrefix = async (req, res, next) => {
  // Ensure shopId exists and is numeric
  if (!req.session || !req.session.shopId) {
    return res.status(403).json({ success: false, message: 'Shop not identified' });
  }

  // sanitize/validate shopId to numeric to avoid injection
  const shopId = Number(req.session.shopId);
  if (!Number.isInteger(shopId) || shopId <= 0) {
    return res.status(403).json({ success: false, message: 'Invalid shop identifier' });
  }

  // safe table prefix (only contains digits after validation)
  req.tablePrefix = `shop_${shopId}_`;

  try {
    const [shops] = await pool.execute('SELECT id, name, logo, currency, primary_color, secondary_color FROM shops WHERE id = ?', [shopId]);

    const s = shops[0] || {};
    req.shop = {
      id: shopId,
      name: s.name || 'My Shop',
      logo: s.logo ? `/uploads/${s.logo}` : '/images/default-logo.png',
      currency: s.currency || 'PKR',
      primary_color: s.primary_color || '#007bff',
      secondary_color: s.secondary_color || '#6c757d'
    };

    next();
  } catch (err) {
    console.error('Error fetching shop details:', err);
    // fallback shop metadata
    req.shop = {
      id: shopId,
      name: 'My Shop',
      logo: '/images/default-logo.png',
      currency: 'PKR',
      primary_color: '#007bff',
      secondary_color: '#6c757d'
    };
    next();
  }
};

// GET user profile page
router.get('/profile', getShopPrefix, async (req, res) => {
    try {
        const userId = req.session.userId;
        
        if (!userId) {
            return res.status(401).render('error', {
                title: 'Error',
                message: 'Please login to access your profile'
            });
        }
        
        // Get user details
        const [users] = await pool.execute(
            'SELECT * FROM users WHERE id = ?',
            [userId]
        );
        
        if (users.length === 0) {
            return res.status(404).render('error', {
                title: 'Error',
                message: 'User not found'
            });
        }
        
        res.render('users/profile', {
            title: 'My Profile',
            user: users[0],
            shop: req.shop
        });
    } catch (err) {
        console.error('Error loading user profile:', err);
        res.status(500).render('error', {
            title: 'Error',
            message: 'Failed to load profile'
        });
    }
});

// GET user statistics
router.get('/api/user/statistics', getShopPrefix, async (req, res) => {
    try {
        const userId = req.session.userId;
        const tablePrefix = req.tablePrefix;
        
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        // Get total bills and sales
        const [bills] = await pool.execute(
            `SELECT COUNT(*) as totalBills, COALESCE(SUM(total_amount), 0) as totalSales
             FROM ${tablePrefix}bills 
             WHERE created_by = ?`,
            [userId]
        );
        
        const totalBills = parseInt(bills[0].totalBills) || 0;
        const totalSales = parseFloat(bills[0].totalSales) || 0;
        const averageBill = totalBills > 0 ? totalSales / totalBills : 0;
        
        // Get this month's bills
        const [monthBills] = await pool.execute(
            `SELECT COUNT(*) as monthBills
             FROM ${tablePrefix}bills 
             WHERE created_by = ? AND MONTH(created_at) = MONTH(CURRENT_DATE()) 
             AND YEAR(created_at) = YEAR(CURRENT_DATE())`,
            [userId]
        );
        
        const thisMonthBills = parseInt(monthBills[0].monthBills) || 0;
        
        res.json({
            success: true,
            statistics: {
                totalBills,
                totalSales,
                averageBill,
                thisMonthBills
            }
        });
    } catch (err) {
        console.error('Error fetching user statistics:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load statistics'
        });
    }
});

// GET salary history
router.get('/api/user/salary-history', getShopPrefix, async (req, res) => {
    try {
        const userId = req.session.userId;
        const tablePrefix = req.tablePrefix;
        
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        const [salaries] = await pool.execute(
            `SELECT * FROM ${tablePrefix}user_salaries 
             WHERE user_id = ? 
             ORDER BY month DESC 
             LIMIT 12`,
            [userId]
        );
        
        res.json({
            success: true,
            salaries: salaries
        });
    } catch (err) {
        console.error('Error fetching salary history:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load salary history'
        });
    }
});

// GET work statistics
router.get('/api/user/work-statistics', getShopPrefix, async (req, res) => {
    try {
        const userId = req.session.userId;
        const tablePrefix = req.tablePrefix;
        
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        // Current month statistics
        const [currentMonth] = await pool.execute(
            `SELECT COUNT(*) as bills, COALESCE(SUM(total_amount), 0) as sales
             FROM ${tablePrefix}bills 
             WHERE created_by = ? AND MONTH(created_at) = MONTH(CURRENT_DATE()) 
             AND YEAR(created_at) = YEAR(CURRENT_DATE())`,
            [userId]
        );
        
        const currentMonthBills = parseInt(currentMonth[0].bills) || 0;
        const currentMonthSales = parseFloat(currentMonth[0].sales) || 0;
        const currentMonthAverage = currentMonthBills > 0 ? currentMonthSales / currentMonthBills : 0;
        
        // Last 6 months data for chart
        const [monthlyData] = await pool.execute(
            `SELECT 
                DATE_FORMAT(created_at, '%Y-%m') as month,
                COUNT(*) as bills,
                COALESCE(SUM(total_amount), 0) as sales
             FROM ${tablePrefix}bills 
             WHERE created_by = ? AND created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH)
             GROUP BY DATE_FORMAT(created_at, '%Y-%m')
             ORDER BY month DESC
             LIMIT 6`,
            [userId]
        );
        
        res.json({
            success: true,
            statistics: {
                currentMonth: {
                    bills: currentMonthBills,
                    sales: currentMonthSales,
                    averageBill: currentMonthAverage
                },
                monthlyData: monthlyData.reverse() // Reverse to show chronological order
            }
        });
    } catch (err) {
        console.error('Error fetching work statistics:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load work statistics'
        });
    }
});

// GET loan information
router.get('/api/user/loans', getShopPrefix, async (req, res) => {
    try {
        const userId = req.session.userId;
        const tablePrefix = req.tablePrefix;
        
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        const [loans] = await pool.execute(
            `SELECT * FROM ${tablePrefix}user_loans 
             WHERE user_id = ? 
             ORDER BY taken_on DESC`,
            [userId]
        );
        
        res.json({
            success: true,
            loans: loans
        });
    } catch (err) {
        console.error('Error fetching loan information:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load loan information'
        });
    }
});

// GET recent activity
router.get('/api/user/recent-activity', getShopPrefix, async (req, res) => {
    try {
        const userId = req.session.userId;
        const tablePrefix = req.tablePrefix;
        
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        const [activities] = await pool.execute(
            `SELECT * FROM ${tablePrefix}active_log_user 
             WHERE user_id = ? 
             ORDER BY created_at DESC 
             LIMIT 10`,
            [userId]
        );
        
        res.json({
            success: true,
            activities: activities
        });
    } catch (err) {
        console.error('Error fetching recent activity:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load recent activity'
        });
    }
});

// PUT update user profile
router.put('/api/user/update-profile', getShopPrefix, async (req, res) => {
    try {
        const userId = req.session.userId;
        const { name, email, phone, cnic, salary, notes } = req.body;
        
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        // Validate required fields
        if (!name || !email) {
            return res.status(400).json({
                success: false,
                message: 'Name and email are required'
            });
        }

        // Check if email already exists for other users
        const [existingUsers] = await pool.execute(
            'SELECT id FROM users WHERE email = ? AND id != ?',
            [email, userId]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Email already exists'
            });
        }

        await pool.execute(
            `UPDATE users 
             SET name = ?, email = ?, phone = ?, cnic = ?, salary = ?, notes = ?, updated_at = NOW()
             WHERE id = ?`,
            [name, email, phone || null, cnic || null, salary ? parseFloat(salary) : null, notes || null, userId]
        );
        
        res.json({
            success: true,
            message: 'Profile updated successfully'
        });
    } catch (err) {
        console.error('Error updating profile:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to update profile'
        });
    }
});

// POST change password
router.post('/api/user/change-password', getShopPrefix, async (req, res) => {
    try {
        const userId = req.session.userId;
        const { currentPassword, newPassword, confirmPassword } = req.body;
        
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        // Validate input
        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'All password fields are required'
            });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'New passwords do not match'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters long'
            });
        }

        // Get current password hash
        const [users] = await pool.execute(
            'SELECT password FROM users WHERE id = ?',
            [userId]
        );
        
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, users[0].password);
        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }
        
        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        // Update password
        await pool.execute(
            'UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?',
            [hashedPassword, userId]
        );
        
        res.json({
            success: true,
            message: 'Password changed successfully'
        });
    } catch (err) {
        console.error('Error changing password:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to change password'
        });
    }
});

module.exports = router;