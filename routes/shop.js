// const express = require('express');
// const router = express.Router();
// const { pool } = require('../db');
// const multer = require('multer');
// const path = require('path');
// const fs = require('fs');
// const bcrypt = require('bcrypt');

// // Configure multer for shop logo uploads
// const storage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     const uploadDir = path.join(__dirname, '../uploads');
//     if (!fs.existsSync(uploadDir)) {
//       fs.mkdirSync(uploadDir, { recursive: true });
//     }
//     cb(null, uploadDir);
//   },
//   filename: (req, file, cb) => {
//     const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
//     cb(null, 'shop-logo-' + uniqueSuffix + path.extname(file.originalname));
//   },
// });

// const upload = multer({
//   storage,
//   limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
//   fileFilter: (req, file, cb) => {
//     if (file.mimetype && file.mimetype.startsWith('image/')) {
//       cb(null, true);
//     } else {
//       cb(new Error('Only image files are allowed!'), false);
//     }
//   },
// });

// // Middleware to set the table prefix and preload shop details
// const getShopPrefix = async (req, res, next) => {
//   if (!req.session || !req.session.shopId) {
//     return res.status(403).json({ success: false, message: 'Shop not identified' });
//   }

//   // Construct a dynamic table prefix for multi-tenant setups
//   req.tablePrefix = `shop_${req.session.shopId}_`;

//   try {
//     const [shops] = await pool.execute('SELECT * FROM shops WHERE id = ?', [req.session.shopId]);
//     if (shops.length === 0) {
//       return res.status(404).render('error', { title: 'Error', message: 'Shop not found' });
//     }

//     const shop = shops[0];
//     req.shop = {
//       id: req.session.shopId,
//       name: shop.name,
//       logo: shop.logo ? `/uploads/${shop.logo}` : '/images/default-logo.png',
//       currency: shop.currency || 'PKR',
//       primary_color: shop.primary_color || '#007bff',
//       secondary_color: shop.secondary_color || '#6c757d',
//       email: shop.email || '',
//       phone: shop.phone || '',
//       address: shop.address || '',
//     };
//     next();
//   } catch (err) {
//     console.error('Error fetching shop details:', err);
//     // Fallback shop details if the database query fails
//     req.shop = {
//       id: req.session.shopId,
//       name: 'My Shop',
//       logo: '/images/default-logo.png',
//       currency: 'PKR',
//       primary_color: '#007bff',
//       secondary_color: '#6c757d',
//       email: '',
//       phone: '',
//       address: '',
//     };
//     next();
//   }
// };

// // Render the shop settings page
// router.get('/', getShopPrefix, async (req, res) => {
//   try {
//     res.render('shop_settings/index', { title: 'Shop Settings', shop: req.shop });
//   } catch (err) {
//     console.error('Error loading shop settings:', err);
//     res.status(500).render('error', { title: 'Error', message: 'Failed to load shop settings' });
//   }
// });

// // Update shop information
// router.put('/api/shop/update', getShopPrefix, upload.single('logo'), async (req, res) => {
//   try {
//     const shopId = req.session.shopId;
//     const { name, email, phone, address, currency, remove_logo } = req.body;

//     // Validate required fields
//     if (!name || !email) {
//       return res.status(400).json({ success: false, message: 'Shop name and email are required' });
//     }

//     // Retrieve current logo from database
//     const [shops] = await pool.execute('SELECT logo FROM shops WHERE id = ?', [shopId]);
//     if (shops.length === 0) {
//       return res.status(404).json({ success: false, message: 'Shop not found' });
//     }
//     const currentShop = shops[0];
//     let logo = currentShop.logo;

//     // Handle new logo upload
//     if (req.file) {
//       // Remove old logo if it exists and isn't the default
//       if (currentShop.logo && currentShop.logo !== 'default-logo.png') {
//         const oldLogoPath = path.join(__dirname, '../uploads', currentShop.logo);
//         if (fs.existsSync(oldLogoPath)) {
//           fs.unlinkSync(oldLogoPath);
//         }
//       }
//       logo = req.file.filename;
//     }

//     // Handle logo removal via a flag in the form data
//     if (remove_logo === 'true') {
//       if (currentShop.logo && currentShop.logo !== 'default-logo.png') {
//         const logoPath = path.join(__dirname, '../uploads', currentShop.logo);
//         if (fs.existsSync(logoPath)) {
//           fs.unlinkSync(logoPath);
//         }
//       }
//       logo = null;
//     }

//     // Build the dynamic update query based on provided fields
//     const updateFields = [];
//     const updateValues = [];
    
//     if (name) {
//       updateFields.push('name = ?');
//       updateValues.push(name);
//     }
//     if (email) {
//       updateFields.push('email = ?');
//       updateValues.push(email);
//     }
//     // Phone and address may be optional and can be set to null
//     if (phone !== undefined) {
//       updateFields.push('phone = ?');
//       updateValues.push(phone || null);
//     }
//     if (address !== undefined) {
//       updateFields.push('address = ?');
//       updateValues.push(address || null);
//     }
//     if (currency) {
//       updateFields.push('currency = ?');
//       updateValues.push(currency);
//     }
//     if (logo !== undefined) {
//       updateFields.push('logo = ?');
//       updateValues.push(logo);
//     }
//     // Always update the updated_at timestamp
//     updateFields.push('updated_at = CURRENT_TIMESTAMP');
//     // Append shopId as the final parameter for the WHERE clause
//     updateValues.push(shopId);

//     if (updateFields.length === 0) {
//       return res.status(400).json({ success: false, message: 'No fields to update' });
//     }

//     const query = `UPDATE shops SET ${updateFields.join(', ')} WHERE id = ?`;
//     await pool.execute(query, updateValues);

//     return res.json({ success: true, message: 'Shop information updated successfully' });
//   } catch (err) {
//     console.error('Error updating shop:', err);
//     // If an error occurs, remove the uploaded file to avoid orphaned files
//     if (req.file) {
//       fs.unlink(req.file.path, (unlinkErr) => {
//         if (unlinkErr) {
//           console.error('Error deleting uploaded file:', unlinkErr);
//         }
//       });
//     }
//     return res.status(500).json({ success: false, message: 'Failed to update shop information: ' + err.message });
//   }
// });

// // Update shop appearance (colors)
// router.put('/api/shop/appearance', getShopPrefix, async (req, res) => {
//   try {
//     const shopId = req.session.shopId;
//     const { primary_color, secondary_color } = req.body;
    
//     if (!primary_color && !secondary_color) {
//       return res.status(400).json({ success: false, message: 'At least one color must be provided' });
//     }
    
//     const updateFields = [];
//     const updateValues = [];
    
//     if (primary_color) {
//       updateFields.push('primary_color = ?');
//       updateValues.push(primary_color);
//     }
//     if (secondary_color) {
//       updateFields.push('secondary_color = ?');
//       updateValues.push(secondary_color);
//     }
    
//     updateFields.push('updated_at = CURRENT_TIMESTAMP');
//     updateValues.push(shopId);
    
//     const query = `UPDATE shops SET ${updateFields.join(', ')} WHERE id = ?`;
//     await pool.execute(query, updateValues);
    
//     return res.json({ success: true, message: 'Appearance settings updated successfully' });
//   } catch (err) {
//     console.error('Error updating appearance:', err);
//     return res.status(500).json({ success: false, message: 'Failed to update appearance settings: ' + err.message });
//   }
// });

// // Get shop statistics (total products, sales, registration date)
// router.get('/api/shop/statistics', getShopPrefix, async (req, res) => {
//   try {
//     const shopId = req.session.shopId;
//     const tablePrefix = req.tablePrefix;
    
//     // Shop creation date
//     const [shopData] = await pool.execute('SELECT created_at FROM shops WHERE id = ?', [shopId]);
    
//     // Count active products
//     const [products] = await pool.execute(
//       `SELECT COUNT(*) AS total FROM ${tablePrefix}products WHERE status = 'active'`
//     );
    
//     // Sum active bills
//     const [sales] = await pool.execute(
//       `SELECT COALESCE(SUM(total_amount), 0) AS total FROM ${tablePrefix}bills WHERE status = 'active'`
//     );
    
//     res.json({
//       success: true,
//       statistics: {
//         registrationDate: shopData[0] ? shopData[0].created_at : new Date(),
//         totalProducts: parseInt(products[0].total || 0, 10),
//         totalSales: parseFloat(sales[0].total || 0),
//       },
//     });
//   } catch (err) {
//     console.error('Error fetching shop statistics:', err);
//     return res.status(500).json({ success: false, message: 'Failed to load shop statistics' });
//   }
// });

// // Get subscription information for the current shop
// router.get('/api/shop/subscription', getShopPrefix, async (req, res) => {
//   try {
//     const shopId = req.session.shopId;
//     const [subscriptions] = await pool.execute(
//       `SELECT s.*, p.name AS plan_name, p.monthly_price, p.quarterly_price, p.yearly_price
//        FROM subscriptions s
//        LEFT JOIN pricing_plans p ON s.plan_name = p.name
//        WHERE s.shop_id = ? AND s.status = 'active'
//        ORDER BY s.created_at DESC LIMIT 1`,
//       [shopId]
//     );
    
//     if (subscriptions.length === 0) {
//       return res.json({ success: true, subscription: null });
//     }
    
//     const subscription = subscriptions[0];
//     let price = subscription.price;
    
//     switch (subscription.duration) {
//       case 'monthly':
//         price = subscription.monthly_price || subscription.price;
//         break;
//       case 'quarterly':
//         price = subscription.quarterly_price || subscription.price;
//         break;
//       case 'yearly':
//         price = subscription.yearly_price || subscription.price;
//         break;
//       default:
//         break;
//     }
    
//     return res.json({
//       success: true,
//       subscription: {
//         plan: subscription.plan_name,
//         price: price,
//         duration: subscription.duration,
//         startDate: subscription.started_at,
//         expiryDate: subscription.expires_at,
//         status: subscription.status,
//       },
//     });
//   } catch (err) {
//     console.error('Error fetching subscription:', err);
//     return res.status(500).json({ success: false, message: 'Failed to load subscription information' });
//   }
// });

// // Get active users for this shop
// router.get('/api/shop/users', getShopPrefix, async (req, res) => {
//   try {
//     const shopId = req.session.shopId;
//     const [users] = await pool.execute(
//       `SELECT id, name, email, role, status, salary, created_at, updated_at
//        FROM users
//        WHERE shop_id = ? AND status = 'active'
//        ORDER BY CASE role
//          WHEN 'owner' THEN 1
//          WHEN 'manager' THEN 2
//          WHEN 'cashier' THEN 3
//          ELSE 4
//        END, name`,
//       [shopId]
//     );
    
//     return res.json({ success: true, users: users });
//   } catch (err) {
//     console.error('Error fetching users:', err);
//     return res.status(500).json({ success: false, message: 'Failed to load users' });
//   }
// });

// // Add a new user to the shop
// router.post('/api/shop/users', getShopPrefix, async (req, res) => {
//   try {
//     const shopId = req.session.shopId;
//     const { name, email, role, salary } = req.body;
    
//     if (!name || !email || !role) {
//       return res.status(400).json({ success: false, message: 'Name, email, and role are required' });
//     }
    
//     // Ensure email uniqueness per shop
//     const [existingUsers] = await pool.execute(
//       'SELECT id FROM users WHERE email = ? AND shop_id = ?',
//       [email, shopId]
//     );
    
//     if (existingUsers.length > 0) {
//       return res.status(400).json({ success: false, message: 'User with this email already exists' });
//     }
    
//     // Generate a temporary password and hash it
//     const tempPassword = Math.random().toString(36).slice(-8);
//     const hashedPassword = await bcrypt.hash(tempPassword, 10);
    
//     const [result] = await pool.execute(
//       `INSERT INTO users
//        (shop_id, name, email, password, role, salary, status, created_at, updated_at)
//        VALUES (?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())`,
//       [shopId, name, email, hashedPassword, role, salary ? parseFloat(salary) : null]
//     );
    
//     return res.json({
//       success: true,
//       message: 'User added successfully',
//       userId: result.insertId,
//       tempPassword: tempPassword,
//     });
//   } catch (err) {
//     console.error('Error adding user:', err);
//     return res.status(500).json({ success: false, message: 'Failed to add user' });
//   }
// });

// // Update an existing user's details
// router.put('/api/shop/users/:id', getShopPrefix, async (req, res) => {
//   try {
//     const shopId = req.session.shopId;
//     const userId = req.params.id;
//     const { name, email, role, salary, status } = req.body;
    
//     // Verify user belongs to this shop
//     const [users] = await pool.execute(
//       'SELECT id FROM users WHERE id = ? AND shop_id = ?',
//       [userId, shopId]
//     );
    
//     if (users.length === 0) {
//       return res.status(404).json({ success: false, message: 'User not found' });
//     }
    
//     // Check for email conflicts if email is being changed
//     if (email) {
//       const [existingUsers] = await pool.execute(
//         'SELECT id FROM users WHERE email = ? AND shop_id = ? AND id != ?',
//         [email, shopId, userId]
//       );
      
//       if (existingUsers.length > 0) {
//         return res.status(400).json({ success: false, message: 'User with this email already exists' });
//       }
//     }
    
//     await pool.execute(
//       `UPDATE users SET name = ?, email = ?, role = ?, salary = ?, status = ?, updated_at = NOW()
//        WHERE id = ? AND shop_id = ?`,
//       [name, email, role, salary ? parseFloat(salary) : null, status, userId, shopId]
//     );
    
//     return res.json({ success: true, message: 'User updated successfully' });
//   } catch (err) {
//     console.error('Error updating user:', err);
//     return res.status(500).json({ success: false, message: 'Failed to update user' });
//   }
// });

// // Soft-delete a user by marking them inactive
// router.delete('/api/shop/users/:id', getShopPrefix, async (req, res) => {
//   try {
//     const shopId = req.session.shopId;
//     const userId = parseInt(req.params.id, 10);
    
//     // Prevent self-deletion
//     if (userId === req.session.userId) {
//       return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
//     }
    
//     // Verify user exists and belongs to this shop
//     const [users] = await pool.execute(
//       'SELECT id, role FROM users WHERE id = ? AND shop_id = ?', 
//       [userId, shopId]
//     );
    
//     if (users.length === 0) {
//       return res.status(404).json({ success: false, message: 'User not found' });
//     }
    
//     // Prevent deletion of the owner role
//     if (users[0].role === 'owner') {
//       return res.status(400).json({ success: false, message: 'Cannot delete owner account' });
//     }
    
//     // Soft delete by marking status inactive
//     await pool.execute(
//       'UPDATE users SET status = "inactive", updated_at = NOW() WHERE id = ? AND shop_id = ?', 
//       [userId, shopId]
//     );
    
//     return res.json({ success: true, message: 'User deleted successfully' });
//   } catch (err) {
//     console.error('Error deleting user:', err);
//     return res.status(500).json({ success: false, message: 'Failed to delete user' });
//   }
// });

// // Create a backup record for the shop
// router.post('/api/shop/backup', getShopPrefix, async (req, res) => {
//   try {
//     const shopId = req.session.shopId;
//     // Create a unique filename for the backup record
//     const filename = `backup_${shopId}_${Date.now()}.sql`;
    
//     const [result] = await pool.execute(
//       'INSERT INTO backups (shop_id, filename, status, created_at) VALUES (?, ?, "completed", NOW())',
//       [shopId, filename]
//     );
    
//     return res.json({
//       success: true,
//       message: 'Backup created successfully',
//       backupId: result.insertId,
//       downloadUrl: `/api/shop/backup/${result.insertId}/download`,
//     });
//   } catch (err) {
//     console.error('Error creating backup:', err);
//     return res.status(500).json({ success: false, message: 'Failed to create backup' });
//   }
// });

// // Soft-reset all shop-related data (mark as inactive instead of hard delete)
// router.delete('/api/shop/reset', getShopPrefix, async (req, res) => {
//   try {
//     const shopId = req.session.shopId;
//     const tablePrefix = req.tablePrefix;
//     const { confirmation } = req.body;
    
//     if (confirmation !== 'DELETE_ALL_DATA') {
//       return res.status(400).json({ 
//         success: false, 
//         message: 'Confirmation required. Type DELETE_ALL_DATA to confirm.' 
//       });
//     }
    
//     // List of shop-specific tables to mark as inactive
//     const tables = ['products', 'bills', 'bill_items', 'user_salaries', 'user_loans', 'active_log_user'];
    
//     for (const table of tables) {
//       try {
//         await pool.execute(
//           `UPDATE ${tablePrefix}${table} SET status = 'inactive' WHERE status = 'active'`
//         );
//       } catch (error) {
//         console.warn(`Could not update table ${table}:`, error.message);
//       }
//     }
    
//     return res.json({ success: true, message: 'All shop data has been reset' });
//   } catch (err) {
//     console.error('Error resetting shop data:', err);
//     return res.status(500).json({ success: false, message: 'Failed to reset shop data' });
//   }
// });

// // Soft-delete the entire shop (mark inactive and cancel subscription)
// router.delete('/api/shop', getShopPrefix, async (req, res) => {
//   try {
//     const shopId = req.session.shopId;
    
//     // Mark the shop inactive
//     await pool.execute(
//       'UPDATE shops SET status = "inactive", updated_at = CURRENT_TIMESTAMP WHERE id = ?', 
//       [shopId]
//     );
    
//     // Cancel any active subscription
//     await pool.execute(
//       'UPDATE subscriptions SET status = "cancelled", updated_at = CURRENT_TIMESTAMP WHERE shop_id = ?', 
//       [shopId]
//     );
    
//     return res.json({ success: true, message: 'Shop has been marked as inactive' });
//   } catch (err) {
//     console.error('Error deleting shop:', err);
//     return res.status(500).json({ success: false, message: 'Failed to delete shop' });
//   }
// });

// module.exports = router;


const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

// Configure multer for shop logo uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'shop-logo-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  },
});

// Middleware to set the table prefix and preload shop details
const getShopPrefix = async (req, res, next) => {
  if (!req.session || !req.session.shopId) {
    return res.status(403).json({ success: false, message: 'Shop not identified' });
  }

  req.tablePrefix = `shop_${req.session.shopId}_`;

  try {
    const [shops] = await pool.execute('SELECT * FROM shops WHERE id = ?', [req.session.shopId]);
    if (shops.length === 0) {
      return res.status(404).render('error', { title: 'Error', message: 'Shop not found' });
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
      address: shop.address || '',
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
      address: '',
    };
    next();
  }
};

// Render the shop settings page
router.get('/', getShopPrefix, async (req, res) => {
  try {
    res.render('shop_settings/index', { title: 'Shop Settings', shop: req.shop });
  } catch (err) {
    console.error('Error loading shop settings:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load shop settings' });
  }
});

// Update shop information - FIXED PATH
router.put('/update', getShopPrefix, upload.single('logo'), async (req, res) => {
  try {
    const shopId = req.session.shopId;
    const { name, email, phone, address, currency, remove_logo } = req.body;

    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'Shop name and email are required' });
    }

    const [shops] = await pool.execute('SELECT logo FROM shops WHERE id = ?', [shopId]);
    if (shops.length === 0) {
      return res.status(404).json({ success: false, message: 'Shop not found' });
    }
    const currentShop = shops[0];
    let logo = currentShop.logo;

    if (req.file) {
      if (currentShop.logo && currentShop.logo !== 'default-logo.png') {
        const oldLogoPath = path.join(__dirname, '../uploads', currentShop.logo);
        if (fs.existsSync(oldLogoPath)) {
          fs.unlinkSync(oldLogoPath);
        }
      }
      logo = req.file.filename;
    }

    if (remove_logo === 'true') {
      if (currentShop.logo && currentShop.logo !== 'default-logo.png') {
        const logoPath = path.join(__dirname, '../uploads', currentShop.logo);
        if (fs.existsSync(logoPath)) {
          fs.unlinkSync(logoPath);
        }
      }
      logo = null;
    }

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
    
    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(shopId);

    if (updateFields.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    const query = `UPDATE shops SET ${updateFields.join(', ')} WHERE id = ?`;
    await pool.execute(query, updateValues);

    return res.json({ success: true, message: 'Shop information updated successfully' });
  } catch (err) {
    console.error('Error updating shop:', err);
    if (req.file) {
      fs.unlink(req.file.path, (unlinkErr) => {
        if (unlinkErr) console.error('Error deleting uploaded file:', unlinkErr);
      });
    }
    return res.status(500).json({ success: false, message: 'Failed to update shop information: ' + err.message });
  }
});

// Update shop appearance - FIXED PATH
router.put('/appearance', getShopPrefix, async (req, res) => {
  try {
    const shopId = req.session.shopId;
    const { primary_color, secondary_color } = req.body;
    
    if (!primary_color && !secondary_color) {
      return res.status(400).json({ success: false, message: 'At least one color must be provided' });
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
    
    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(shopId);
    
    const query = `UPDATE shops SET ${updateFields.join(', ')} WHERE id = ?`;
    await pool.execute(query, updateValues);
    
    return res.json({ success: true, message: 'Appearance settings updated successfully' });
  } catch (err) {
    console.error('Error updating appearance:', err);
    return res.status(500).json({ success: false, message: 'Failed to update appearance settings: ' + err.message });
  }
});

// Get shop statistics - FIXED PATH
router.get('/statistics', getShopPrefix, async (req, res) => {
  try {
    const shopId = req.session.shopId;
    const tablePrefix = req.tablePrefix;
    
    const [shopData] = await pool.execute('SELECT created_at FROM shops WHERE id = ?', [shopId]);
    const [products] = await pool.execute(
      `SELECT COUNT(*) AS total FROM ${tablePrefix}products WHERE status = 'active'`
    );
    const [sales] = await pool.execute(
      `SELECT COALESCE(SUM(total_amount), 0) AS total FROM ${tablePrefix}bills WHERE status = 'active'`
    );
    
    res.json({
      success: true,
      statistics: {
        registrationDate: shopData[0] ? shopData[0].created_at : new Date(),
        totalProducts: parseInt(products[0].total || 0, 10),
        totalSales: parseFloat(sales[0].total || 0),
      },
    });
  } catch (err) {
    console.error('Error fetching shop statistics:', err);
    return res.status(500).json({ success: false, message: 'Failed to load shop statistics' });
  }
});

// Get subscription information - FIXED PATH
router.get('/subscription', getShopPrefix, async (req, res) => {
  try {
    const shopId = req.session.shopId;
    const [subscriptions] = await pool.execute(
      `SELECT s.*, p.name AS plan_name, p.monthly_price, p.quarterly_price, p.yearly_price
       FROM subscriptions s
       LEFT JOIN pricing_plans p ON s.plan_name = p.name
       WHERE s.shop_id = ? AND s.status = 'active'
       ORDER BY s.created_at DESC LIMIT 1`,
      [shopId]
    );
    
    if (subscriptions.length === 0) {
      return res.json({ success: true, subscription: null });
    }
    
    const subscription = subscriptions[0];
    let price = subscription.price;
    
    switch (subscription.duration) {
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
        break;
    }
    
    return res.json({
      success: true,
      subscription: {
        plan: subscription.plan_name,
        price: price,
        duration: subscription.duration,
        startDate: subscription.started_at,
        expiryDate: subscription.expires_at,
        status: subscription.status,
      },
    });
  } catch (err) {
    console.error('Error fetching subscription:', err);
    return res.status(500).json({ success: false, message: 'Failed to load subscription information' });
  }
});

// Get active users - FIXED PATH
router.get('/users', getShopPrefix, async (req, res) => {
  try {
    const shopId = req.session.shopId;
    const [users] = await pool.execute(
      `SELECT id, name, email, role, status, salary, created_at, updated_at
       FROM users
       WHERE shop_id = ? AND status = 'active'
       ORDER BY CASE role
         WHEN 'owner' THEN 1
         WHEN 'manager' THEN 2
         WHEN 'cashier' THEN 3
         ELSE 4
       END, name`,
      [shopId]
    );
    
    return res.json({ success: true, users: users });
  } catch (err) {
    console.error('Error fetching users:', err);
    return res.status(500).json({ success: false, message: 'Failed to load users' });
  }
});

// Add a new user - FIXED PATH
router.post('/users', getShopPrefix, async (req, res) => {
  try {
    const shopId = req.session.shopId;
    const { name, email, role, salary } = req.body;
    
    if (!name || !email || !role) {
      return res.status(400).json({ success: false, message: 'Name, email, and role are required' });
    }
    
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE email = ? AND shop_id = ?',
      [email, shopId]
    );
    
    if (existingUsers.length > 0) {
      return res.status(400).json({ success: false, message: 'User with this email already exists' });
    }
    
    const tempPassword = Math.random().toString(36).slice(-8);
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    
    const [result] = await pool.execute(
      `INSERT INTO users
       (shop_id, name, email, password, role, salary, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())`,
      [shopId, name, email, hashedPassword, role, salary ? parseFloat(salary) : null]
    );
    
    return res.json({
      success: true,
      message: 'User added successfully',
      userId: result.insertId,
      tempPassword: tempPassword,
    });
  } catch (err) {
    console.error('Error adding user:', err);
    return res.status(500).json({ success: false, message: 'Failed to add user' });
  }
});

// Update user - FIXED PATH
router.put('/users/:id', getShopPrefix, async (req, res) => {
  try {
    const shopId = req.session.shopId;
    const userId = req.params.id;
    const { name, email, role, salary, status } = req.body;
    
    const [users] = await pool.execute(
      'SELECT id FROM users WHERE id = ? AND shop_id = ?',
      [userId, shopId]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    if (email) {
      const [existingUsers] = await pool.execute(
        'SELECT id FROM users WHERE email = ? AND shop_id = ? AND id != ?',
        [email, shopId, userId]
      );
      
      if (existingUsers.length > 0) {
        return res.status(400).json({ success: false, message: 'User with this email already exists' });
      }
    }
    
    await pool.execute(
      `UPDATE users SET name = ?, email = ?, role = ?, salary = ?, status = ?, updated_at = NOW()
       WHERE id = ? AND shop_id = ?`,
      [name, email, role, salary ? parseFloat(salary) : null, status, userId, shopId]
    );
    
    return res.json({ success: true, message: 'User updated successfully' });
  } catch (err) {
    console.error('Error updating user:', err);
    return res.status(500).json({ success: false, message: 'Failed to update user' });
  }
});

// Delete user - FIXED PATH
router.delete('/users/:id', getShopPrefix, async (req, res) => {
  try {
    const shopId = req.session.shopId;
    const userId = parseInt(req.params.id, 10);
    
    if (userId === req.session.userId) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
    }
    
    const [users] = await pool.execute(
      'SELECT id, role FROM users WHERE id = ? AND shop_id = ?', 
      [userId, shopId]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    if (users[0].role === 'owner') {
      return res.status(400).json({ success: false, message: 'Cannot delete owner account' });
    }
    
    await pool.execute(
      'UPDATE users SET status = "inactive", updated_at = NOW() WHERE id = ? AND shop_id = ?', 
      [userId, shopId]
    );
    
    return res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    console.error('Error deleting user:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete user' });
  }
});

// Create backup - FIXED PATH
router.post('/backup', getShopPrefix, async (req, res) => {
  try {
    const shopId = req.session.shopId;
    const filename = `backup_${shopId}_${Date.now()}.sql`;
    
    const [result] = await pool.execute(
      'INSERT INTO backups (shop_id, filename, status, created_at) VALUES (?, ?, "completed", NOW())',
      [shopId, filename]
    );
    
    return res.json({
      success: true,
      message: 'Backup created successfully',
      backupId: result.insertId,
      downloadUrl: `/api/shop/backup/${result.insertId}/download`,
    });
  } catch (err) {
    console.error('Error creating backup:', err);
    return res.status(500).json({ success: false, message: 'Failed to create backup' });
  }
});

// Reset shop data - FIXED PATH
router.delete('/reset', getShopPrefix, async (req, res) => {
  try {
    const shopId = req.session.shopId;
    const tablePrefix = req.tablePrefix;
    const { confirmation } = req.body;
    
    if (confirmation !== 'DELETE_ALL_DATA') {
      return res.status(400).json({ 
        success: false, 
        message: 'Confirmation required. Type DELETE_ALL_DATA to confirm.' 
      });
    }
    
    const tables = ['products', 'bills', 'bill_items', 'user_salaries', 'user_loans', 'active_log_user'];
    
    for (const table of tables) {
      try {
        await pool.execute(
          `UPDATE ${tablePrefix}${table} SET status = 'inactive' WHERE status = 'active'`
        );
      } catch (error) {
        console.warn(`Could not update table ${table}:`, error.message);
      }
    }
    
    return res.json({ success: true, message: 'All shop data has been reset' });
  } catch (err) {
    console.error('Error resetting shop data:', err);
    return res.status(500).json({ success: false, message: 'Failed to reset shop data' });
  }
});

// Delete shop - FIXED PATH
router.delete('/', getShopPrefix, async (req, res) => {
  try {
    const shopId = req.session.shopId;
    
    await pool.execute(
      'UPDATE shops SET status = "inactive", updated_at = CURRENT_TIMESTAMP WHERE id = ?', 
      [shopId]
    );
    
    await pool.execute(
      'UPDATE subscriptions SET status = "cancelled", updated_at = CURRENT_TIMESTAMP WHERE shop_id = ?', 
      [shopId]
    );
    
    return res.json({ success: true, message: 'Shop has been marked as inactive' });
  } catch (err) {
    console.error('Error deleting shop:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete shop' });
  }
});

module.exports = router;