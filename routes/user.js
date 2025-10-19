const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for user profile pictures
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../public/uploads/profiles');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + (req.session.userId || 'unknown') + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// GET /user - User Profile Page
router.get('/', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.redirect('/login');
    }

    const [users] = await pool.execute(
      `SELECT u.*, s.name as shop_name, s.email as shop_email, s.phone as shop_phone, 
              s.address as shop_address, s.logo as shop_logo, sub.plan_name, sub.expires_at
       FROM users u 
       LEFT JOIN shops s ON u.shop_id = s.id 
       LEFT JOIN subscriptions sub ON s.id = sub.shop_id AND sub.status = 'active'
       WHERE u.id = ?`,
      [req.session.userId]
    );

    if (users.length === 0) {
      return res.status(404).render('error', { 
        title: 'User Not Found', 
        error: 'User profile not found' 
      });
    }

    const user = users[0];
      
    // Get user activity logs
    let activities = [];
    try {
      const activityTable = `shop_${req.session.shopId}_active_log_user`;
      const [activityRows] = await pool.execute(
        `SELECT action, action_type, created_at 
         FROM \`${activityTable}\` 
         WHERE user_id = ? 
         ORDER BY created_at DESC 
         LIMIT 10`,
        [req.session.userId]
      );
      activities = activityRows || [];
    } catch (error) {
      console.log('Activity table not found or error:', error.message);
    }

    // Get salary information
    let salaryHistory = [];
    try {
      const salaryTable = `shop_${req.session.shopId}_user_salaries`;
      const [salaryRows] = await pool.execute(
        `SELECT month, amount, paid_on, status, notes 
         FROM \`${salaryTable}\` 
         WHERE user_id = ? 
         ORDER BY month DESC 
         LIMIT 6`,
        [req.session.userId]
      );
      salaryHistory = salaryRows || [];
    } catch (error) {
      console.log('Salary table not found or error:', error.message);
    }

    // Get loan information
    let loanHistory = [];
    try {
      const loanTable = `shop_${req.session.shopId}_user_loans`;
      const [loanRows] = await pool.execute(
        `SELECT amount, taken_on, status, due_amount, notes 
         FROM \`${loanTable}\` 
         WHERE user_id = ? 
         ORDER BY taken_on DESC 
         LIMIT 5`,
        [req.session.userId]
      );
      loanHistory = loanRows || [];
    } catch (error) {
      console.log('Loan table not found or error:', error.message);
    }

    res.render('user_profile', {
      title: 'My Profile',
      user: user,
      activities: activities,
      salaryHistory: salaryHistory,
      loanHistory: loanHistory,
      success: req.query.success,
      error: req.query.error
    });

  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).render('error', { 
      title: 'Server Error', 
      error: 'Failed to load user profile' 
    });
  }
});

// POST /user - Update User Profile
router.post('/', upload.single('profile_picture'), async (req, res) => {
  const { name, email, phone, cnic, salary } = req.body;
  
  let connection;
  try {
    if (!req.session.userId) {
      return res.redirect('/login');
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Check if email already exists for other users
    const [existingUsers] = await connection.execute(
      `SELECT id FROM users WHERE email = ? AND id != ? AND shop_id = ?`,
      [email, req.session.userId, req.session.shopId]
    );

    if (existingUsers.length > 0) {
      return res.redirect('/user_profile?error=Email already exists');
    }

    // First, check if profile_picture column exists, if not, add it
    try {
      await connection.execute('SELECT profile_picture FROM users LIMIT 1');
    } catch (error) {
      // Column doesn't exist, so add it
      await connection.execute('ALTER TABLE users ADD COLUMN profile_picture VARCHAR(255) NULL');
    }

    // Update user data
    const updateFields = ['name = ?', 'email = ?', 'phone = ?', 'cnic = ?', 'updated_at = NOW()'];
    const updateValues = [name, email, phone || null, cnic || null];

    // Add salary if user is owner/admin
    if (req.session.role === 'owner' || req.session.role === 'admin') {
      updateFields.push('salary = ?');
      updateValues.push(salary ? parseFloat(salary) : null);
    }

    // Add profile picture if uploaded
    if (req.file) {
      updateFields.push('profile_picture = ?');
      updateValues.push(req.file.filename);
      
      // Delete old profile picture if exists
      const [oldUser] = await connection.execute(
        'SELECT profile_picture FROM users WHERE id = ?',
        [req.session.userId]
      );
      
      if (oldUser[0]?.profile_picture) {
        const oldPath = path.join(__dirname, '../public/uploads/profiles', oldUser[0].profile_picture);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
    }

    updateValues.push(req.session.userId);

    await connection.execute(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    // Log the activity
    try {
      const activityTable = `shop_${req.session.shopId}_active_log_user`;
      await connection.execute(
        `INSERT INTO \`${activityTable}\` (user_id, action, action_type) 
         VALUES (?, 'Updated profile information', 'profile_update')`,
        [req.session.userId]
      );
    } catch (error) {
      console.log('Could not log activity:', error.message);
    }

    await connection.commit();
    connection.release();

    // Update session data
    req.session.username = name;

    res.redirect('/user_profile?success=Profile updated successfully');

  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    
    // Delete uploaded file if error occurred
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }
    
    console.error('Error updating profile:', error);
    res.redirect('/user_profile?error=Failed to update profile');
  }
});

// POST /user/change-password - Change Password
router.post('/change-password', async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  
  let connection;
  try {
    if (!req.session.userId) {
      return res.redirect('/login');
    }

    if (!current_password || !new_password || !confirm_password) {
      return res.redirect('/user_profile?error=All password fields are required');
    }

    if (new_password !== confirm_password) {
      return res.redirect('/user_profile?error=New passwords do not match');
    }

    if (new_password.length < 6) {
      return res.redirect('/user_profile?error=Password must be at least 6 characters long');
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Get current password hash
    const [users] = await connection.execute(
      'SELECT password FROM users WHERE id = ?',
      [req.session.userId]
    );

    if (users.length === 0) {
      return res.redirect('/user_profile?error=User not found');
    }

    const isMatch = await bcrypt.compare(current_password, users[0].password);
    if (!isMatch) {
      return res.redirect('/user_profile?error=Current password is incorrect');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // Update password
    await connection.execute(
      'UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?',
      [hashedPassword, req.session.userId]
    );

    // Log the activity
    try {
      const activityTable = `shop_${req.session.shopId}_active_log_user`;
      await connection.execute(
        `INSERT INTO \`${activityTable}\` (user_id, action, action_type) 
         VALUES (?, 'Changed password', 'security')`,
        [req.session.userId]
      );
    } catch (error) {
      console.log('Could not log activity:', error.message);
    }

    await connection.commit();
    connection.release();

    res.redirect('/user_profile?success=Password changed successfully');

  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    
    console.error('Error changing password:', error);
    res.redirect('/user_profile?error=Failed to change password');
  }
});

module.exports = router;