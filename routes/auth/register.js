const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
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
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Only image files are allowed!'), false);
  }
});

// Pricing
const PRICING = {
  basic: { monthly: 1000, quarterly: 2850, yearly: 10200 },
  pro: { monthly: 2500, quarterly: 7125, yearly: 25500 },
  enterprise: { monthly: 5000, quarterly: 14250, yearly: 51000 }
};

// GET /register
router.get('/register', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  res.render('auth/register', { title: 'Register', error: null, success: null });
});

// POST /register
router.post('/register', upload.single('logo'), async (req, res) => {
  const {
    shopName, email, phone, address, plan, subscriptionDuration, paymentMethod, paymentDetails,
    currency, primaryColor, secondaryColor,
    ownerName, ownerEmail, ownerPassword, confirmPassword, ownerPhone, cnic, salary
  } = req.body;

  let connection;

  try {
    if (!shopName || !email || !ownerName || !ownerEmail || !ownerPassword || !confirmPassword || !plan || !subscriptionDuration || !paymentMethod) {
      return res.status(400).render('auth/register', {
        title: 'Register Your Shop',
        error: 'All required fields must be filled',
        success: null
      });
    }

    if (ownerPassword !== confirmPassword) {
      return res.status(400).render('auth/register', {
        title: 'Register Your Shop',
        error: 'Passwords do not match',
        success: null
      });
    }

    // Start transaction
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Create shop
    await connection.execute(
      `INSERT INTO shops (name, email, phone, address, logo, plan, currency, primary_color, secondary_color, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())`,
      [
        shopName,
        email,
        phone || null,
        address || null,
        req.file ? req.file.filename : null,
        plan,
        currency || 'PKR',
        primaryColor || '#007bff',
        secondaryColor || '#6c757d'
      ]
    );

    // Get newly inserted shop ID
    const [shopRow] = await connection.execute(
      `SELECT id FROM shops WHERE email = ? ORDER BY id DESC LIMIT 1`,
      [email]
    );

    if (!shopRow.length) throw new Error('Shop ID retrieval failed.');
    const shopId = shopRow[0].id;

    // Calculate subscription
    const price = PRICING[plan][subscriptionDuration];
    const startDate = new Date();
    const expireDate = new Date(startDate);

    if (subscriptionDuration === 'quarterly') {
      expireDate.setMonth(startDate.getMonth() + 3);
    } else if (subscriptionDuration === 'yearly') {
      expireDate.setFullYear(startDate.getFullYear() + 1);
    } else {
      expireDate.setMonth(startDate.getMonth() + 1);
    }

    // Insert subscription
    await connection.execute(
      `INSERT INTO subscriptions
       (shop_id, plan_name, price, duration, started_at, expires_at, status, payment_method, payment_details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NOW())`,
      [
        shopId, plan, price, subscriptionDuration, startDate, expireDate, paymentMethod, paymentDetails || null
      ]
    );

    // Hash password
    const hashedPassword = await bcrypt.hash(ownerPassword, 10);

    // Create owner user
    const [userResult] = await connection.execute(
      `INSERT INTO users 
       (shop_id, name, email, password, phone, cnic, salary, role, status, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'owner', 'active', NOW(), NOW())`,
      [
        shopId,
        ownerName,
        ownerEmail,
        hashedPassword,
        ownerPhone || null,
        cnic || null,
        salary ? parseFloat(salary) : null
      ]
    );

    const userId = userResult.insertId;

    // Create shop-specific tables
    if (!shopId || isNaN(shopId)) throw new Error('Invalid shop ID');
    await createShopTables(connection, shopId);

    // Commit transaction
    await connection.commit();
    connection.release();

    // Set session
    req.session.userId = userId;
    req.session.role = 'owner';
    req.session.username = ownerName;
    req.session.shopId = shopId;

    return res.redirect('/?newShop=true');

  } catch (err) {
    // Rollback safely
    if (connection) {
      try { await connection.rollback(); } catch (rErr) { console.error('Rollback failed:', rErr); }
      try { connection.release(); } catch (relErr) { console.error('Release failed:', relErr); }
    }

    // Delete uploaded file if exists
    if (req.file) fs.unlink(req.file.path, () => {});

    console.error('Registration error:', err);
    return res.status(500).render('auth/register', {
      title: 'Register Your Shop',
      error: 'An error occurred during registration. Please try again.',
      success: null
    });
  }
});

// Create shop-specific tables
async function createShopTables(connection, shopId) {
  const prefix = `shop_${shopId}_`;

  await connection.execute(`
    CREATE TABLE ${prefix}products (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      brand VARCHAR(255),
      category VARCHAR(255),
      size VARCHAR(100),
      sku VARCHAR(100),
      image VARCHAR(100),
      barcode VARCHAR(100),
      quantity INT NOT NULL DEFAULT 0,
      min_stock_alert INT DEFAULT 5,
      buying_price DECIMAL(10,2) NOT NULL,
      selling_price DECIMAL(10,2) NOT NULL,
      tax_percent DECIMAL(5,2) DEFAULT 0,
      status ENUM('active','inactive') DEFAULT 'active',
      created_by BIGINT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX (category),
      INDEX (status)
    )
  `);

  await connection.execute(`
    CREATE TABLE ${prefix}bills (
      id INT PRIMARY KEY AUTO_INCREMENT,
      bill_number VARCHAR(50) NOT NULL,
      customer_name VARCHAR(255),
      customer_phone VARCHAR(50),
      subtotal DECIMAL(10,2) NOT NULL,
      discount DECIMAL(10,2) DEFAULT 0,
      tax DECIMAL(10,2) DEFAULT 0,
      total_amount DECIMAL(10,2) NOT NULL,
      paid_amount DECIMAL(10,2) NOT NULL,
      due_amount DECIMAL(10,2) DEFAULT 0,
      payment_method VARCHAR(50),
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (bill_number),
      INDEX (customer_phone),
      INDEX (created_at)
    )
  `);

  await connection.execute(`
    CREATE TABLE ${prefix}bill_items (
      id INT PRIMARY KEY AUTO_INCREMENT,
      bill_id INT NOT NULL,
      product_id INT NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      quantity INT NOT NULL,
      unit_price DECIMAL(10,2) NOT NULL,
      discount DECIMAL(10,2) DEFAULT 0,
      total_price DECIMAL(10,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bill_id) REFERENCES ${prefix}bills(id) ON DELETE CASCADE,
      INDEX (product_id)
    )
  `);

  await connection.execute(`
    CREATE TABLE ${prefix}user_salaries (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      month VARCHAR(7) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      paid_on DATE,
      status ENUM('paid','unpaid') DEFAULT 'unpaid',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, month),
      INDEX (status)
    )
  `);

  await connection.execute(`
    CREATE TABLE ${prefix}user_loans (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      taken_on DATE NOT NULL,
      reason TEXT,
      status ENUM('paid','unpaid','partial') DEFAULT 'unpaid',
      installment DECIMAL(10,2),
      due_amount DECIMAL(10,2),
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX (user_id),
      INDEX (status)
    )
  `);

  await connection.execute(`
    CREATE TABLE ${prefix}active_log_user (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      action VARCHAR(255) NOT NULL,
      action_type VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

module.exports = router;
