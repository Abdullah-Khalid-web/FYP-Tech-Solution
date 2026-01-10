const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
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
        // Get shop details from database
        const [shops] = await pool.execute(
            'SELECT * FROM shops WHERE id = UUID_TO_BIN(?)',
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

// Configure multer for user profile pictures
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../public/uploads/profiles');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
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

// Helper function to convert UUID string to binary
function uuidToBin(uuid) {
    return pool.execute('SELECT UUID_TO_BIN(?) as bin', [uuid])
        .then(([rows]) => rows[0].bin);
}

// Helper function to convert binary UUID to string
function binToUuid(bin) {
    return pool.execute('SELECT BIN_TO_UUID(?) as uuid', [bin])
        .then(([rows]) => rows[0].uuid);
}

// GET /user_profile - User Profile Page
router.get('/', getShopData, async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.redirect('/login');
        }

        // Convert userId to binary for query
        const userIdBin = await uuidToBin(req.session.userId);
        const shopIdBin = await uuidToBin(req.session.shopId);

        const [users] = await pool.execute(
            `SELECT 
                u.*,
                BIN_TO_UUID(u.id) as user_uuid,
                BIN_TO_UUID(u.shop_id) as shop_uuid,
                BIN_TO_UUID(u.role_id) as role_uuid,
                s.name as shop_name,
                s.email as shop_email,
                s.phone as shop_phone,
                s.address as shop_address,
                s.logo as shop_logo,
                s.currency as shop_currency,
                s.plan as shop_plan,
                s.status as shop_status,
                r.role_name as role_name
            FROM users u 
            LEFT JOIN shops s ON u.shop_id = s.id 
            LEFT JOIN roles r ON u.role_id = r.id
            WHERE u.id = ? AND u.shop_id = ?`,
            [userIdBin, shopIdBin]
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
            const [activityRows] = await pool.execute(
                `SELECT 
                    action_type as action,
                    action_type,
                    created_at,
                    details
                FROM admin_actions 
                WHERE admin_id = ? AND shop_id = ?
                ORDER BY created_at DESC 
                LIMIT 10`,
                [userIdBin, shopIdBin]
            );
            
            // Parse JSON details if they exist
            activities = activityRows.map(row => ({
                ...row,
                action: row.details ? JSON.parse(row.details).action || row.action_type : row.action_type
            }));
        } catch (error) {
            console.log('Error fetching activities:', error.message);
        }

        // Get salary information
        let salaryHistory = [];
        try {
            const [salaryRows] = await pool.execute(
                `SELECT 
                    month,
                    net_amount as amount,
                    paid_on,
                    status,
                    notes 
                FROM user_salary 
                WHERE user_id = ? AND shop_id = ?
                ORDER BY month DESC 
                LIMIT 6`,
                [userIdBin, shopIdBin]
            );
            salaryHistory = salaryRows || [];
        } catch (error) {
            console.log('Salary query error:', error.message);
        }

        // Get loan information
        let loanHistory = [];
        try {
            const [loanRows] = await pool.execute(
                `SELECT 
                    amount,
                    description as notes,
                    created_at as taken_on,
                    transaction_type,
                    balance as due_amount
                FROM user_loan 
                WHERE user_id = ? AND shop_id = ?
                ORDER BY created_at DESC 
                LIMIT 5`,
                [userIdBin, shopIdBin]
            );
            
            // Map transaction_type to status for display
            loanHistory = (loanRows || []).map(loan => ({
                ...loan,
                status: loan.transaction_type === 'loan_repayment' ? 'repaid' : 
                        loan.transaction_type === 'loan_given' ? 'active' : 'partial'
            }));
        } catch (error) {
            console.log('Loan query error:', error.message);
        }

        res.render('user_profile', {
            title: 'My Profile',
            user: {
                id: user.user_uuid,
                name: user.name,
                email: user.email,
                phone: user.phone,
                cnic: user.cnic,
                salary: user.salary,
                loan: user.loan,
                status: user.status,
                role: user.role_name || req.session.role,
                created_at: user.created_at,
                profile_picture: user.profile_picture,
                notes: user.notes
            },
            shop: req.shop, // Using shop data from middleware
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
            error: 'Failed to load user profile: ' + error.message 
        });
    }
});

// POST /user_profile - Update User Profile
router.post('/', getShopData, upload.single('profile_picture'), async (req, res) => {
    const { name, email, phone, cnic, salary } = req.body;
    
    let connection;
    try {
        if (!req.session.userId) {
            return res.redirect('/login');
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        const userIdBin = await uuidToBin(req.session.userId);
        const shopIdBin = await uuidToBin(req.session.shopId);

        // Check if email already exists for other users in the same shop
        const [existingUsers] = await connection.execute(
            `SELECT id FROM users WHERE email = ? AND id != ? AND shop_id = ?`,
            [email, userIdBin, shopIdBin]
        );

        if (existingUsers.length > 0) {
            return res.redirect('/user_profile?error=Email already exists in this shop');
        }

        // Check if profile_picture column exists, if not, add it
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
                [userIdBin]
            );
            
            if (oldUser[0]?.profile_picture) {
                const oldPath = path.join(__dirname, '../public/uploads/profiles', oldUser[0].profile_picture);
                if (fs.existsSync(oldPath)) {
                    fs.unlinkSync(oldPath);
                }
            }
        }

        updateValues.push(userIdBin);

        await connection.execute(
            `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );

        // Log the activity
        try {
            const activityIdBin = await uuidToBin(uuidv4());
            await connection.execute(
                `INSERT INTO admin_actions (id, admin_id, shop_id, action_type, details) 
                 VALUES (?, ?, ?, 'profile_update', ?)`,
                [
                    activityIdBin,
                    userIdBin,
                    shopIdBin,
                    JSON.stringify({ action: 'Updated profile information' })
                ]
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
        res.redirect('/user_profile?error=Failed to update profile: ' + error.message);
    }
});

// POST /user_profile/change-password - Change Password
router.post('/change-password', getShopData, async (req, res) => {
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

        const userIdBin = await uuidToBin(req.session.userId);
        const shopIdBin = await uuidToBin(req.session.shopId);

        // Get current password hash
        const [users] = await connection.execute(
            'SELECT password FROM users WHERE id = ?',
            [userIdBin]
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
            [hashedPassword, userIdBin]
        );

        // Log the activity
        try {
            const activityIdBin = await uuidToBin(uuidv4());
            await connection.execute(
                `INSERT INTO admin_actions (id, admin_id, shop_id, action_type, details) 
                 VALUES (?, ?, ?, 'security', ?)`,
                [
                    activityIdBin,
                    userIdBin,
                    shopIdBin,
                    JSON.stringify({ action: 'Changed password' })
                ]
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
        res.redirect('/user_profile?error=Failed to change password: ' + error.message);
    }
});

module.exports = router;