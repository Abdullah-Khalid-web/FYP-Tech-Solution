const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
      success: null,
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || ''
    });
  } catch (err) {
    console.error(err);
    res.render('auth/register', {
      title: 'Shop Registration',
      plans: [],
      error: 'Unable to load pricing plans',
      success: null,
      stripePublishableKey: ''
    });
  }
};

/* HANDLE REGISTER - Updated with Stripe */
exports.register = async (req, res) => {
  console.log('BODY:', req.body);
  console.log('FILE:', req.file);

  const {
    shopName, plan, subscriptionDuration,
    email, phone, address, currency,
    ownerName, ownerEmail, ownerphone, cnic, ownerPassword, confirmPassword,
    paymentMethod, paymentDetails, paymentIntentId
  } = req.body;

  // Validation
  if (!shopName || !plan || !ownerName || !ownerEmail || !ownerPassword) {
    const [plans] = await pool.execute(
      `SELECT BIN_TO_UUID(id) AS id, name, monthly_price, quarterly_price, yearly_price
       FROM pricing_plans WHERE status = 'active' ORDER BY monthly_price ASC`
    );
    return res.render('auth/register', { 
      title: 'Shop Registration',
      plans,
      error: 'Please fill all required fields',
      success: null,
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    });
  }

  if (ownerPassword !== confirmPassword) {
    const [plans] = await pool.execute(
      `SELECT BIN_TO_UUID(id) AS id, name, monthly_price, quarterly_price, yearly_price
       FROM pricing_plans WHERE status = 'active' ORDER BY monthly_price ASC`
    );
    return res.render('auth/register', { 
      title: 'Shop Registration',
      plans,
      error: 'Passwords do not match',
      success: null,
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY
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

    // If payment method is stripe, verify payment intent
    if (paymentMethod === 'stripe') {
      if (!paymentIntentId) {
        throw new Error('Payment not completed. Please complete the payment first.');
      }
      
      // Verify payment intent with Stripe
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      
      if (paymentIntent.status !== 'succeeded') {
        throw new Error('Payment not successful. Please try again.');
      }
      
      if (paymentIntent.amount !== Math.round(price * 100)) {
        throw new Error('Payment amount mismatch. Please contact support.');
      }
    }

    const hashedPassword = await bcrypt.hash(ownerPassword, 10);
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    
    let logo = null;
    if (req.file) {
      logo = `uploads/shop_logos/${req.file.filename}`;
    }

    let primaryColor = '#007bff';
    let secondaryColor = '#6c757d';

    // Insert Shop
    await conn.execute(
      `INSERT INTO shops 
        (id, name, email, phone, address, currency, logo, plan, primary_color, secondary_color, status)
      VALUES 
        (UUID_TO_BIN(UUID()), ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [shopName, email, phone, address, currency, logo, plan, primaryColor, secondaryColor]
    );

    const [[{ shop_id }]] = await conn.execute(
      'SELECT id AS shop_id FROM shops WHERE name = ? ORDER BY created_at DESC LIMIT 1',
      [shopName]
    );

    const shopId = shop_id;

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
      `INSERT INTO users (id, shop_id, name, email, password, role_id, phone, cnic, status)
      VALUES (UUID_TO_BIN(UUID()), ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [shopId, ownerName, ownerEmail, hashedPassword, roleId, ownerphone, cnic]
    );

    // Calculate subscription expiry date
    let expiresAt = new Date();
    if (subscriptionDuration === 'monthly') expiresAt.setMonth(expiresAt.getMonth() + 1);
    if (subscriptionDuration === 'quarterly') expiresAt.setMonth(expiresAt.getMonth() + 3);
    if (subscriptionDuration === 'yearly') expiresAt.setMonth(expiresAt.getMonth() + 12);

    const pad = (n) => n.toString().padStart(2, '0');
    const expiresAtStr = `${expiresAt.getFullYear()}-${pad(expiresAt.getMonth() + 1)}-${pad(expiresAt.getDate())}`;

    // Insert Subscription
    await conn.execute(
      `INSERT INTO subscriptions
      (id, shop_id, plan_name, price, duration, payment_method, payment_details, started_at, expires_at, status)
      VALUES (UUID_TO_BIN(UUID()), ?, ?, ?, ?, ?, ?, CURDATE(), ?, 'active')`,
      [shopId, pricingPlan.name, price, subscriptionDuration, paymentMethod, paymentDetails || null, expiresAtStr]
    );

    // Store payment transaction if using Stripe
    if (paymentMethod === 'stripe' && paymentIntentId) {
      await conn.execute(
        `INSERT INTO payment_transactions 
        (id, transaction_id, amount, currency, status, payment_method, metadata, created_at)
        VALUES (UUID_TO_BIN(UUID()), ?, ?, ?, 'completed', 'stripe', ?, NOW())`,
        [paymentIntentId, price, process.env.STRIPE_CURRENCY || 'pkr', JSON.stringify({ shop_id: shopId, plan: plan, duration: subscriptionDuration })]
      );
    }

    await conn.commit();
    conn.release();

    res.redirect('/payment-success');
  } catch (err) {
    console.error(err);
    const [plans] = await pool.execute(
      `SELECT BIN_TO_UUID(id) AS id, name, monthly_price, quarterly_price, yearly_price
       FROM pricing_plans WHERE status = 'active' ORDER BY monthly_price ASC`
    );
    
    res.render('auth/register', {
      title: 'Shop Registration',
      plans,
      error: 'Registration failed: ' + err.message,
      success: null,
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    });
  }
};