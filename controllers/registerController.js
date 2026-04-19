const bcrypt = require('bcryptjs');
const { pool } = require('../db');

/* SHOW REGISTER PAGE */
exports.showRegister = async (req, res) => {
  try {
    const [plans] = await pool.execute(
      `SELECT 
        BIN_TO_UUID(id) AS id,
        name,
        monthly_price,
        quarterly_price,
        yearly_price
       FROM pricing_plans
       WHERE status = 'active'
       ORDER BY monthly_price ASC`
    );

    res.render('auth/register', {
      title: 'Shop Registration',
      plans,
      error: null,
      success: null
    });
  } catch (err) {
    console.error(err);
    res.render('auth/register', {
      title: 'Shop Registration',
      plans: [],
      error: 'Unable to load pricing plans',
      success: null
    });
  }
};


/* HANDLE REGISTER */
exports.register = async (req, res) => {
  console.log('BODY:', req.body); // Make sure this shows the submitted form
  console.log('FILE:', req.file); // Uploaded logo file

  const {
    shopName, plan, subscriptionDuration,
    email, phone, address, currency,
    ownerName, ownerEmail,ownerphone , cnic, ownerPassword, confirmPassword, paymentMethod, paymentDetails
  } = req.body;

  if (!shopName || !plan || !ownerName || !ownerEmail || !ownerPassword) {
    // reload the page with pricing plans so dropdown still works
    const [plans] = await pool.execute(
      `SELECT 
         BIN_TO_UUID(id) AS id,
         name,
         monthly_price,
         quarterly_price,
         yearly_price
       FROM pricing_plans
       WHERE status = 'active'
       ORDER BY monthly_price ASC`
    );

    return res.render('auth/register', { 
      title: 'Shop Registration',
      plans,
      error: 'Please fill all required fields',
      success: null
    });
  }

  if (ownerPassword !== confirmPassword) {
    return res.render('auth/register', { 
      title: 'Shop Registration',
      plans: [],
      error: 'Passwords do not match',
      success: null
    });
  }

  try {
    const [plans] = await pool.execute(
      `SELECT * FROM pricing_plans WHERE name = ? LIMIT 1`,
      [plan]
    );

    if (!plans.length) throw new Error('Invalid plan selected');
    const pricingPlan = plans[0];

    let price = 0;
    if (subscriptionDuration === 'monthly') price = pricingPlan.monthly_price;
    if (subscriptionDuration === 'quarterly') price = pricingPlan.quarterly_price;
    if (subscriptionDuration === 'yearly') price = pricingPlan.yearly_price;

    const hashedPassword = await bcrypt.hash(ownerPassword, 10);

    const conn = await pool.getConnection();
    await conn.beginTransaction();

    // // Insert Shop
    // const [shopResult] = await conn.execute(
    //   `INSERT INTO shops (id, name, email, phone, address, currency)
    //    VALUES (UUID_TO_BIN(UUID()), ?, ?, ?, ?, ?)`,
    //   [shopName, email, phone, address, currency]
    // );
    
    // Determine logo path (if uploaded)
      let logo = req.file ? req.file.filename : null;

      // Default colors
      let primaryColor = '#007bff';
      let secondaryColor = '#6c757d';

      // Insert Shop
      const [shopResult] = await conn.execute(
        `INSERT INTO shops 
          (id, name, email, phone, address, currency, logo, plan, primary_color, secondary_color, status)
        VALUES 
          (UUID_TO_BIN(UUID()), ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
        [
          shopName, email, phone, address, currency,
          logo, plan, primaryColor, secondaryColor
        ]
      );


    const [[{ shop_id }]] = await conn.execute(
      'SELECT id AS shop_id FROM shops WHERE name = ? ORDER BY created_at DESC LIMIT 1',
      [shopName]
    );

    const shopId = shop_id;

    // Insert Owner
    // await conn.execute(
    //   `INSERT INTO users (id, shop_id, name, email, password, role)
    //    VALUES (UUID_TO_BIN(UUID()), ?, ?, ?, ?, 'Shop Owner')`,
    //   [shopId, ownerName, ownerEmail, hashedPassword]
    // );
    // Get Shop Owner role ID
    const [[shopOwnerRole]] = await conn.execute(
      `SELECT id FROM roles WHERE role_name = 'Shop Owner' LIMIT 1`
    );

    if (!shopOwnerRole) {
      throw new Error('Shop Owner role not found in roles table');
    }

    const roleId = shopOwnerRole.id;

    // Insert Owner
    await conn.execute(
      `INSERT INTO users (id, shop_id, name, email, password, role_id,phone,cnic status)
      VALUES (UUID_TO_BIN(UUID()), ?, ?, ?, ?, ?,?, ?, 'active')`,
      [shopId, ownerName, ownerEmail, hashedPassword, roleId, ownerphone , cnic,]
    );


      // Calculate subscription expiry date
      let expiresAt = new Date();
      if (subscriptionDuration === 'monthly') expiresAt.setMonth(expiresAt.getMonth() + 1);
      if (subscriptionDuration === 'quarterly') expiresAt.setMonth(expiresAt.getMonth() + 3);
      if (subscriptionDuration === 'yearly') expiresAt.setMonth(expiresAt.getMonth() + 12);

      // Format as YYYY-MM-DD
      const pad = (n) => n.toString().padStart(2, '0');
      const expiresAtStr = `${expiresAt.getFullYear()}-${pad(expiresAt.getMonth() + 1)}-${pad(expiresAt.getDate())}`;

      // Insert Subscription
      await conn.execute(
        `INSERT INTO subscriptions
        (id, shop_id, plan_name, price, duration, payment_method, payment_details, started_at, expires_at, status)
        VALUES (UUID_TO_BIN(UUID()), ?, ?, ?, ?, ?, ?, CURDATE(), ?, 'active')`,
        [
          shopId,
          pricingPlan.name,
          price,
          subscriptionDuration,
          paymentMethod || null,
          paymentDetails || null,
          expiresAtStr
        ]
      );

    await conn.commit();
    conn.release();

    res.redirect('/login');
  } catch (err) {
    console.error(err);
    res.render('auth/register', {
      title: 'Shop Registration',
      plans: [],
      error: 'Registration failed',
      success: null
    });
  }
};


