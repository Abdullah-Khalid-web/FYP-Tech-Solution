// App.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const flash = require('express-flash');
const expressLayouts = require('express-ejs-layouts');
const cors = require('cors');
const { pool } = require('./db');
const RoleHelper = require('./helpers/roleHelper');
const permissionHelper = require('./helpers/permissionHelper');
const { isAuthenticated } = require('./middleware/auth');
const roleAuth = require('./middleware/roleAuth');

const app = express();

/* ------------------ MIDDLEWARE ------------------ */
app.use(cors({
  origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:3000'],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(session({
  name: 'managehub.sid',
  secret: process.env.SESSION_SECRET || 'managehub-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}));

app.use(flash());

/* ------------------ VIEW ENGINE ------------------ */
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layouts/layout');

/* ------------------ STATIC FILES ------------------ */
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/* ------------------ DEFAULT GLOBALS ------------------ */
// This sets defaults that will be used if user is not logged in
// Make role helper available in all views
app.use((req, res, next) => {
    res.locals.roleHelper = new RoleHelper(req.session);
    res.locals.session = req.session;
    next();
});

// Make permission helper available in all views
app.use(async (req, res, next) => {
    res.locals.permissionHelper = permissionHelper;
    res.locals.permission = {
        hasPermission: async (slug) => {
            if (!req.session?.userId) return false;
            if (Array.isArray(req.userPermissionSlugs) && req.userPermissionSlugs.length) {
                return req.userPermissionSlugs.includes(slug);
            }
            return await permissionHelper.hasPermission(req.session.userId, slug);
        },
        getUserPermissions: async () => {
            if (res.locals.userPermissions) return res.locals.userPermissions;
            if (!req.session?.userId) return { list: [], byModule: {} };
            return permissionHelper.getUserPermissions(req.session.userId);
        }
    };
    res.locals.hasPermission = res.locals.permission.hasPermission;
    next();
});

/* ------------------ DEFAULT GLOBALS ------------------ */
app.use((req, res, next) => {
  // Initialize with defaults
  res.locals.user = null;
  res.locals.title = 'Manage Hub';
  
  // Default shop data (for public pages)
  res.locals.shop = {
    id: null,
    name: 'Manage Hub',
    // logo: '/images/default-logo.png',
    logo: 'uploads/shop_logos/default-logo.png',
    phone: '+92 000000000',
    address: 'NextGenTech Solution, Quetta, Pakistan',
    email: 'NextGenTechSolution@gmail.com',
    currency: 'PKR',
    primary_color: '#007bff',
    secondary_color: '#6c757d'
  };
  
  res.locals.error = null;
  res.locals.success = null;
  next();
});

/* ------------------ LOAD USER + SHOP ------------------ */
app.use(async (req, res, next) => {
  try {
    if (req.session.userId) {
      // Fetch user details - FIXED QUERY
      const [users] = await pool.execute(
        `SELECT 
          BIN_TO_UUID(u.id) AS id,
          u.name,
          u.email,
          u.phone,
          u.cnic,
          u.status,
          u.profile_picture,
          BIN_TO_UUID(u.role_id) AS role_id,
          r.role_name,
          BIN_TO_UUID(u.shop_id) AS shop_id
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE u.id = UUID_TO_BIN(?)`,
        [req.session.userId]
      );

      if (users.length > 0) {
        const user = users[0];
        
        // Store complete user in res.locals
        res.locals.user = {
          id: user.id,
          username: user.name,
          name: user.name,
          email: user.email,
          phone: user.phone,
          cnic: user.cnic,
          role_id: user.role_id,
          roleName: user.role_name || 'No Role',
          shopId: user.shop_id,
          status: user.status,
          profile_picture: user.profile_picture
        };

        // Update session with user data
        req.session.roleName = user.role_name || req.session.roleName || 'No Role';
        req.session.roleId = user.role_id || req.session.roleId;
        req.session.username = user.name;
        req.session.userEmail = user.email;
        req.session.shopId = user.shop_id;

        // console.log('User loaded in middleware:', {
        //   name: user.name,
        //   role: user.role_name,
        //   roleId: user.role_id,
        //   shopId: user.shop_id
        // });

        // Fetch shop details if shop_id exists
        if (user.shop_id) {
          const [shops] = await pool.execute(
            `SELECT 
              BIN_TO_UUID(id) AS id,
              name,
              logo,
              phone,
              address,
              email,
              currency,
              primary_color,
              secondary_color
            FROM shops 
            WHERE id = UUID_TO_BIN(?)`,
            [user.shop_id]
          );

          if (shops.length > 0) {
            const shop = shops[0];
            res.locals.shop = {
              id: shop.id,
              name: shop.name || 'Manage Hub',
              logo: shop.logo ? `/uploads/${shop.logo}` : '/shop_logos/default-logo.png',
              phone: shop.phone || '+92 000000000',
              address: shop.address || 'NextGenTech Solution, Quetta, Pakistan',
              email: shop.email || 'NextGenTechSolution@gmail.com',
              currency: shop.currency || 'PKR',
              primary_color: shop.primary_color || '#007bff',
              secondary_color: shop.secondary_color || '#6c757d'
            };
          }
        }
      } else {
        // User ID exists in session but user not found in database
        console.log('User not found in database for ID:', req.session.userId);
        res.locals.user = null;
      }
    } else {
      // Not logged in - set defaults
      res.locals.user = null;
      res.locals.shop = {
        name: 'Manage Hub',
        logo: 'uploads/shop_logos/default-logo.png',
        phone: '+92 000000000',
        address: 'NextGenTech Solution, Quetta, Pakistan',
        email: 'NextGenTechSolution@gmail.com',
        currency: 'PKR',
        primary_color: '#007bff',
        secondary_color: '#6c757d'
      };
    }
    next();
  } catch (err) {
    console.error('Error loading user/shop:', err);
    // Don't crash the app, just continue with defaults
    res.locals.user = null;
    res.locals.shop = {
      name: 'Manage Hub',
      logo: 'uploads/shop_logos/default-logo.png',
      phone: '+92 000000000',
      address: 'NextGenTech Solution, Quetta, Pakistan',
      email: 'NextGenTechSolution@gmail.com',
      currency: 'PKR',
      primary_color: '#007bff',
      secondary_color: '#6c757d'
    };
    next();
  }
});

app.use(async (req, res, next) => {
    if (req.session?.userId) {
        try {
            const permissionData = await permissionHelper.getUserPermissions(req.session.userId);
            req.userPermissions = permissionData.list.map(perm => perm.slug);
            res.locals.userPermissions = permissionData;
            res.locals.userPermissionSlugs = req.userPermissions;
            res.locals.currentUser = res.locals.user;
        } catch (err) {
            console.error('Error loading user permissions:', err);
            req.userPermissions = [];
            res.locals.userPermissions = { list: [], byModule: {} };
            res.locals.userPermissionSlugs = [];
            res.locals.currentUser = res.locals.user || null;
        }
    } else {
        req.userPermissions = [];
        res.locals.userPermissions = { list: [], byModule: {} };
        res.locals.userPermissionSlugs = [];
        res.locals.currentUser = null;
    }

    next();
});


/* ------------------ HOME ROUTE ------------------ */
app.get('/', async (req, res) => {
  if (req.session.userId) {
    // User is logged in → redirect to dashboard
    return res.redirect('/dashboard');
  }

  // User not logged in → show public index page
  try {
    const [testimonials] = await pool.execute(
      `SELECT f.subject, f.message, f.rating, s.name AS shop_name
       FROM feedback f
       JOIN shops s ON f.shop_id = s.id
       WHERE f.status IN ('replied', 'resolved') AND f.rating IS NOT NULL
       ORDER BY f.created_at DESC
       LIMIT 6`
    );
    res.render('index', { title: 'Home', testimonials });
  } catch (err) {
    console.error('Home testimonials error:', err);
    res.render('index', { title: 'Home', testimonials: [] });
  }
});

/* ------------------ STATIC PUBLIC PAGES ------------------ */
app.get('/about', (req, res) => res.render('about', { title: 'About Us' }));
app.get('/contact', (req, res) => res.render('contact', {
  title: 'Contact Us',
  success: req.query.success,
  error: req.query.error
}));
app.post('/contact', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !subject || !message) {
      return res.redirect('/contact?error=Please complete all fields');
    }

    const publicShopId = process.env.CONTACT_SHOP_ID || null;
    const [shops] = publicShopId
      ? await pool.execute('SELECT BIN_TO_UUID(id) AS id FROM shops WHERE id = UUID_TO_BIN(?) LIMIT 1', [publicShopId])
      : await pool.execute('SELECT BIN_TO_UUID(id) AS id FROM shops ORDER BY created_at ASC LIMIT 1');

    if (shops.length) {
      await pool.execute(
        `INSERT INTO feedback (id, shop_id, subject, message, rating, status)
         VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), ?, ?, NULL, 'new')`,
        [
          shops[0].id,
          `[Contact] ${subject}`,
          `From: ${name} <${email}>\n\n${message}`
        ]
      );
    }

    res.redirect('/contact?success=Message sent successfully');
  } catch (err) {
    console.error('Contact form error:', err);
    res.redirect('/contact?error=Unable to send message right now');
  }
});
app.get('/privacy', (req, res) => res.render('privacy', { title: 'Privacy Policy' }));
app.get('/pricing', async (req, res) => {
  try {
    const [pricingPlans] = await pool.execute(
      `SELECT *, BIN_TO_UUID(id) AS plan_id
       FROM pricing_plans
       WHERE status = 'active'
       ORDER BY monthly_price ASC`
    );
    res.render('pricing', { title: 'Subscription Plans', pricingPlans });
  } catch (err) {
    console.error('Pricing page error:', err);
    res.render('pricing', { title: 'Subscription Plans', pricingPlans: [] });
  }
});

/* ------------------ ROUTES ------------------ */

// app.use('/', require('./routes/auth'));
app.use('/', require('./routes/auth/login'));
app.use('/', require('./routes/auth/logout'));
app.use('/', require('./routes/auth/register'));
app.use('/admin', require('./routes/admin'));
app.use('/', isAuthenticated, require('./routes/dashboard'));

/* ------------- AI INTEGRATION ROUTES ------------- */
app.use('/api/ai', require('./routes/ai'));            // Frontend → Backend → AI proxy
app.use('/api', require('./routes/aiDataApi'));          // AI module → Backend data endpoints
/* ------------------ PROTECTED ROUTES (AUTHENTICATION REQUIRED) ------------------ */

// Products - requires authentication (everyone can view products)
app.use('/products', isAuthenticated, require('./routes/products'));

// Sales routes - requires sales access
app.use('/bills', isAuthenticated, roleAuth.requireSalesAccess, require('./routes/bills'));
app.use('/Allbills', isAuthenticated, roleAuth.requireSalesAccess, require('./routes/Allbills'));
app.use('/customer', isAuthenticated, roleAuth.requireSalesAccess, require('./routes/customer'));



// Employee management routes
app.use('/EmpMgmt', isAuthenticated, roleAuth.requireEmployeeManagement, require('./routes/EmpMgmt'));

// Inventory routes - requires inventory access
app.use('/alerts', isAuthenticated, roleAuth.requireInventoryAccess, require('./routes/alerts'));
app.use('/raw', isAuthenticated, roleAuth.requireInventoryAccess, require('./routes/raw'));

// Finance routes - requires finance access
app.use('/expenses', isAuthenticated, roleAuth.requireFinanceAccess, require('./routes/expenses'));
app.use('/cash-deposits', isAuthenticated, roleAuth.requireFinanceAccess, require('./routes/cashDeposits'));

// Reports - requires report access
app.use('/reports', isAuthenticated, roleAuth.requireReportAccess, require('./routes/reports'));

// Shop settings - requires settings access
app.use('/shop_setting', isAuthenticated, roleAuth.requireSettingsAccess, require('./routes/shop'));

// User profile - requires authentication (any logged-in user)
app.use('/user_profile', isAuthenticated, require('./routes/user'));

// Suppliers - requires authentication
app.use('/suppliers', isAuthenticated, require('./routes/suppliers'));

// Feedback - requires authentication
app.use('/feedback', isAuthenticated, require('./routes/feedback'));

/* ------------------ 404 ------------------ */
app.use((req, res) => {
  res.status(404).render('404', { title: 'Page Not Found' });
});

/* ------------------ ERROR HANDLER ------------------ */
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).render('error', {
    title: 'Error',
    message: err.message || 'Something went wrong',
    error: process.env.NODE_ENV === 'development' ? err : null
  });
});

module.exports = app;
