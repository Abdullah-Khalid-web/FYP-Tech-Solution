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
    if (req.file) fs.unlink(req.file.path, () => { });

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
      supplier_id INT NULL,
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
      notes VARCHAR(250),
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
      tax_amount VARCHAR(50),
      item_type VARCHAR(50),
      total_price DECIMAL(10,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bill_id) REFERENCES ${prefix}bills(id) ON DELETE CASCADE,
      INDEX (product_id)
    )
  `);

  // await connection.execute(`
  //   CREATE TABLE ${prefix}user_salaries (
  //     id INT PRIMARY KEY AUTO_INCREMENT,
  //     user_id INT NOT NULL,
  //     month VARCHAR(7) NOT NULL,
  //     amount DECIMAL(10,2) NOT NULL,
  //     net_amount DECIMAL(12,2),
  //     paid_on DATE,
  //     status ENUM('paid','unpaid') DEFAULT 'unpaid',
  //     notes TEXT,
  //     loan_deductions JSON ;
  //     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  //     UNIQUE (user_id, month),
  //     INDEX (status)
  //   )
  // `);

    await connection.execute(`
  CREATE TABLE ${prefix}user_salaries (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    month VARCHAR(7) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    net_amount DECIMAL(12,2),
    bonus DECIMAL(10,2) DEFAULT 0,
    fine DECIMAL(10,2) DEFAULT 0,
    paid_on DATE,
    status ENUM('paid','pending') DEFAULT 'pending',
    notes TEXT,
    loan_deductions JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE (user_id, month),
    INDEX (status),
    INDEX (user_id)
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
  await connection.execute(`
    CREATE TABLE ${prefix}expenses (
      id INT PRIMARY KEY AUTO_INCREMENT,
      category VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      expense_date DATE NOT NULL,
      payment_method VARCHAR(50) DEFAULT 'cash',
      receipt_number VARCHAR(100),
      created_by INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX (category),
    INDEX (expense_date),
    INDEX (created_by)
  )
  `);
  await connection.execute(`
    CREATE TABLE ${prefix}raw_materials (
id INT PRIMARY KEY AUTO_INCREMENT,
  shop_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  sku VARCHAR(100) UNIQUE,
  barcode VARCHAR(100),
  category VARCHAR(100),
  description TEXT,
  unit_of_measure VARCHAR(50) DEFAULT 'pcs',
  current_stock DECIMAL(10,3) DEFAULT 0,
  min_stock_level DECIMAL(10,3) DEFAULT 0,
  max_stock_level DECIMAL(10,3) DEFAULT 0,
  cost_price DECIMAL(10,2) DEFAULT 0,
  supplier_id INT,
  batch_tracking BOOLEAN DEFAULT FALSE,
  expiry_tracking BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX (shop_id),
  INDEX (category),
  INDEX (supplier_id),
  INDEX (is_active)

  );
  `);
  await connection.execute(`
    CREATE TABLE ${prefix}raw_suppliers (
   id INT PRIMARY KEY AUTO_INCREMENT,
  shop_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  contact_person VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  address TEXT,
  tax_number VARCHAR(100),
  payment_terms VARCHAR(100),
  rating TINYINT DEFAULT 5,
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX (shop_id),
  INDEX (is_active)

    );
  `);
  await connection.execute(`
    CREATE TABLE ${prefix}raw_material_stock_movements (
     id INT PRIMARY KEY AUTO_INCREMENT,
  shop_id INT NOT NULL,
  raw_material_id INT NOT NULL,
  batch_number VARCHAR(100),
  movement_type ENUM('in', 'out', 'adjustment') NOT NULL,
  quantity DECIMAL(10,3) NOT NULL,
  unit_cost DECIMAL(10,2) DEFAULT 0,
  total_cost DECIMAL(10,2) DEFAULT 0,
  reference_type ENUM('purchase', 'production', 'waste', 'adjustment', 'transfer') NOT NULL,
  reference_id INT,
  notes TEXT,
  movement_date DATE NOT NULL,
  expiry_date DATE,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX (shop_id),
  INDEX (raw_material_id),
  INDEX (movement_date),
  INDEX (batch_number),
  FOREIGN KEY (raw_material_id) REFERENCES ${prefix}raw_materials(id) ON DELETE CASCADE

  );
`);
  await connection.execute(`
    CREATE TABLE ${prefix}raw_material_alerts (
      id INT PRIMARY KEY AUTO_INCREMENT,
      shop_id INT NOT NULL,
      raw_material_id INT NOT NULL,
      alert_type ENUM('low_stock', 'expiry', 'over_stock') NOT NULL,
      alert_message TEXT NOT NULL,
      current_value DECIMAL(10,3),
      threshold_value DECIMAL(10,3),
      is_resolved BOOLEAN DEFAULT FALSE,
      resolved_by INT,
      resolved_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      
      INDEX (shop_id),
      INDEX (raw_material_id),
      INDEX (is_resolved),
      INDEX (alert_type),
      FOREIGN KEY (raw_material_id) REFERENCES ${prefix}raw_materials(id) ON DELETE CASCADE
    );
    `);
    await connection.execute(`
    -- Suppliers table
CREATE TABLE ${prefix}_suppliers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    city VARCHAR(100),
    country VARCHAR(100),
    tax_number VARCHAR(100),
    payment_terms VARCHAR(100),
    account_number VARCHAR(100),
    bank_name VARCHAR(255),
    notes TEXT,
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);


      `);

    await connection.execute(`
      -- Supplier products table (many-to-many relationship)
      CREATE TABLE ${prefix}_supplier_products (
        id INT AUTO_INCREMENT PRIMARY KEY,
    supplier_id INT NOT NULL,
    product_id INT NOT NULL,
    supplier_sku VARCHAR(100),
    supplier_price DECIMAL(10,2),
    min_order_quantity INT DEFAULT 1,
    lead_time_days INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES ${prefix}_suppliers(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES ${prefix}_products(id) ON DELETE CASCADE,
    UNIQUE KEY unique_supplier_product (supplier_id, product_id)
);
`);
await connection.execute(`
  -- Salary history table
CREATE TABLE ${prefix}_salary_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    old_salary DECIMAL(10,2) NOT NULL,
    new_salary DECIMAL(10,2) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    effective_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

`);
await connection.execute(`
  -- Loan transactions table
  CREATE TABLE  ${prefix}_loan_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    loan_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    type ENUM('payment', 'salary_deduction') NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (loan_id) REFERENCES ${prefix}_user_loans(id) ON DELETE CASCADE
  );
  
  `);
  await connection.execute(`
    -- Create salary history table
CREATE TABLE ${prefix}_salary_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    old_salary DECIMAL(10,2) NOT NULL DEFAULT 0,
    new_salary DECIMAL(10,2) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    effective_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

`);
await connection.execute(`
  -- Create loan transactions table
  CREATE TABLE IF NOT EXISTS ${prefix}_loan_transactions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      loan_id INT NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      type ENUM('payment', 'salary_deduction') NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  
      `);
  }

module.exports = router;
