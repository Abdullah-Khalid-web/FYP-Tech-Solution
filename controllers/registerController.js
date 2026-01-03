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
    ownerName, ownerEmail, ownerPassword, confirmPassword
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

    // Insert Shop
    const [shopResult] = await conn.execute(
      `INSERT INTO shops (id, name, email, phone, address, currency)
       VALUES (UUID_TO_BIN(UUID()), ?, ?, ?, ?, ?)`,
      [shopName, email, phone, address, currency]
    );
    
    const [[{ shop_id }]] = await conn.execute(
      'SELECT id AS shop_id FROM shops WHERE name = ? ORDER BY created_at DESC LIMIT 1',
      [shopName]
    );

    const shopId = shop_id;

    // Insert Owner
    await conn.execute(
      `INSERT INTO users (id, shop_id, name, email, password, role)
       VALUES (UUID_TO_BIN(UUID()), ?, ?, ?, ?, 'Shop Owner')`,
      [shopId, ownerName, ownerEmail, hashedPassword]
    );

    // Insert Subscription
    await conn.execute(
      `INSERT INTO subscriptions
       (id, shop_id, plan_name, price, duration, started_at, expires_at)
       VALUES (
         UUID_TO_BIN(UUID()), ?, ?, ?, ?, CURDATE(),
         DATE_ADD(CURDATE(),
           INTERVAL CASE
             WHEN ? = 'monthly' THEN 1
             WHEN ? = 'quarterly' THEN 3
             WHEN ? = 'yearly' THEN 12
           END MONTH
         )
       )`,
      [
        shopId, pricingPlan.name, price, subscriptionDuration,
        subscriptionDuration, subscriptionDuration, subscriptionDuration
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


