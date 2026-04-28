// App.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const flash = require('express-flash');
const expressLayouts = require('express-ejs-layouts');
<<<<<<< HEAD
const cors = require('cors');
const { pool } = require('./db');
=======
const { pool } = require('./db');
const RoleHelper = require('./helpers/roleHelper');
const permissionHelper = require('./helpers/permissionHelper');
const { isAuthenticated } = require('./middleware/auth');
const roleAuth = require('./middleware/roleAuth');
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96

const app = express();

/* ------------------ MIDDLEWARE ------------------ */
<<<<<<< HEAD
app.use(cors({
  origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:3000'],
  credentials: true,
}));
=======
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96
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

<<<<<<< HEAD
/* ------------------ DEFAULT GLOBALS ------------------ */
// This sets defaults that will be used if user is not logged in
=======
// Make role helper available in all views
app.use((req, res, next) => {
    res.locals.roleHelper = new RoleHelper(req.session);
    res.locals.session = req.session;
    next();
});

// Make permission helper available in all views
app.use(async (req, res, next) => {
    res.locals.permissionHelper = permissionHelper;
    res.locals.hasPermission = async (slug) => {
        if (!req.session?.userId) return false;
        return await permissionHelper.hasPermission(req.session.userId, slug);
    };
    next();
});

/* ------------------ DEFAULT GLOBALS ------------------ */
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96
app.use((req, res, next) => {
  // Initialize with defaults
  res.locals.user = null;
  res.locals.title = 'Manage Hub';
  
  // Default shop data (for public pages)
  res.locals.shop = {
    id: null,
    name: 'Manage Hub',
    logo: '/images/default-logo.png',
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
<<<<<<< HEAD
      // Fetch user details
=======
      // Fetch user details with role information
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96
      const [users] = await pool.execute(
        `SELECT 
          BIN_TO_UUID(u.id) AS id,
          u.name,
<<<<<<< HEAD
          u.role_id,
          BIN_TO_UUID(u.shop_id) AS shop_id
        FROM users u
=======
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
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96
        WHERE u.id = UUID_TO_BIN(?)`,
        [req.session.userId]
      );

      if (users.length > 0) {
        const user = users[0];
        
<<<<<<< HEAD
        // Store user in res.locals
        res.locals.user = {
          id: user.id,
          username: user.name,
          role_id: user.role_id,
          shopId: user.shop_id
        };

        // Also update session for backward compatibility
        req.session.username = user.name;
        req.session.shopId = user.shop_id;
=======
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

        // Update session with any missing data
        req.session.roleName = user.role_name || req.session.roleName || 'No Role';
        req.session.roleId = user.role_id || req.session.roleId;
        req.session.username = user.name;
        req.session.userEmail = user.email;
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96

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
<<<<<<< HEAD
            // Store shop in res.locals
=======
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96
            res.locals.shop = {
              id: shop.id,
              name: shop.name || 'Manage Hub',
              logo: shop.logo ? `/uploads/${shop.logo}` : '/images/default-logo.png',
              phone: shop.phone || '+92 000000000',
              address: shop.address || 'NextGenTech Solution, Quetta, Pakistan',
              email: shop.email || 'NextGenTechSolution@gmail.com',
              currency: shop.currency || 'PKR',
              primary_color: shop.primary_color || '#007bff',
              secondary_color: shop.secondary_color || '#6c757d'
            };
          }
        }
<<<<<<< HEAD
      }
=======

        console.log('User loaded in middleware:', {
          name: user.name,
          role: user.role_name,
          shopId: user.shop_id
        });
      }
    } else {
      // Not logged in - set defaults
      res.locals.user = null;
      res.locals.shop = {
        name: 'Manage Hub',
        logo: '/images/default-logo.png',
        phone: '+92 000000000',
        address: 'NextGenTech Solution, Quetta, Pakistan',
        email: 'NextGenTechSolution@gmail.com',
        currency: 'PKR',
        primary_color: '#007bff',
        secondary_color: '#6c757d'
      };
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96
    }
    next();
  } catch (err) {
    console.error('Error loading user/shop:', err);
    // Don't crash the app, just continue with defaults
    res.locals.user = null;
    res.locals.shop = {
      name: 'Manage Hub',
      logo: '/images/default-logo.png',
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

/* ------------------ HOME ROUTE ------------------ */
app.get('/', (req, res) => {
  if (req.session.userId) {
    // User is logged in → redirect to dashboard
    return res.redirect('/dashboard');
  }

  // User not logged in → show public index page
  res.render('index', { title: 'Home' });
});

<<<<<<< HEAD
/* ------------------ STATIC PUBLIC PAGES ------------------ */
app.get('/about', (req, res) => res.render('about', { title: 'About Us' }));
app.get('/contact', (req, res) => res.render('contact', { title: 'Contact Us' }));
app.get('/privacy', (req, res) => res.render('privacy', { title: 'Privacy Policy' }));

/* ------------------ ROUTES ------------------ */

app.use('/', require('./routes/auth/login'));
app.use('/', require('./routes/auth/logout'));
app.use('/', require('./routes/auth/register'));
app.use('/', require('./routes/dashboard'));

app.use('/products', require('./routes/products'));
app.use('/bills', require('./routes/bills'));
app.use('/Allbills', require('./routes/Allbills'));
app.use('/EmpMgmt', require('./routes/EmpMgmt'));
app.use('/reports', require('./routes/reports'));
app.use('/user_profile', require('./routes/user'));
app.use('/shop_setting', require('./routes/shop'));
app.use('/alerts', require('./routes/alerts'));
app.use('/expenses', require('./routes/expenses'));
app.use('/raw', require('./routes/raw'));
app.use('/admin', require('./routes/admin'));
app.use('/suppliers', require('./routes/suppliers'));

/* ------------- AI INTEGRATION ROUTES ------------- */
app.use('/api/ai', require('./routes/ai'));            // Frontend → Backend → AI proxy
app.use('/api', require('./routes/aiDataApi'));          // AI module → Backend data endpoints
=======
/* ------------------ PUBLIC ROUTES (NO AUTH NEEDED) ------------------ */
app.use('/', require('./routes/auth/login'));
app.use('/', require('./routes/auth/logout'));
app.use('/', require('./routes/auth/register'));

/* ------------------ PROTECTED ROUTES (AUTHENTICATION REQUIRED) ------------------ */

// Dashboard - requires authentication

app.use('/', isAuthenticated, require('./routes/dashboard'));

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

// Reports - requires report access
app.use('/reports', isAuthenticated, roleAuth.requireReportAccess, require('./routes/reports'));

// Admin routes - requires admin role
app.use('/admin', isAuthenticated, roleAuth.requireRole(['Super Admin', 'Admin']), require('./routes/admin'));

// Shop settings - requires settings access
app.use('/shop_setting', isAuthenticated, roleAuth.requireSettingsAccess, require('./routes/shop'));

// User profile - requires authentication (any logged-in user)
app.use('/user_profile', isAuthenticated, require('./routes/user'));

// Suppliers - requires authentication
app.use('/suppliers', isAuthenticated, require('./routes/suppliers'));

// Feedback - requires authentication
app.use('/feedback', isAuthenticated, require('./routes/feedback'));

/* ------------------ MAKE PERMISSIONS AVAILABLE IN VIEWS ------------------ */
app.use(async (req, res, next) => {
    res.locals.permission = {
        hasPermission: async (slug) => {
            if (!req.session?.userId) return false;
            return await permissionHelper.hasPermission(req.session.userId, slug);
        },
        getUserPermissions: async () => {
            if (!req.session?.userId) return { list: [], byModule: {} };
            return await permissionHelper.getUserPermissions(req.session.userId);
        }
    };
    
    // Also make current user permissions available
    if (req.session?.userId) {
        try {
            const [userRows] = await pool.execute(
                `SELECT 
                    BIN_TO_UUID(u.id) as id,
                    u.name,
                    u.email,
                    u.phone,
                    u.cnic,
                    u.status,
                    u.profile_picture,
                    BIN_TO_UUID(u.role_id) as role_id,
                    r.role_name,
                    BIN_TO_UUID(u.shop_id) as shop_id
                FROM users u
                LEFT JOIN roles r ON u.role_id = r.id
                WHERE u.id = UUID_TO_BIN(?)`,
                [req.session.userId]
            );
            
            if (userRows.length) {
                res.locals.currentUser = userRows[0];
                
                // Get user permissions
                const perms = await permissionHelper.getUserPermissions(req.session.userId);
                res.locals.userPermissions = perms;
            }
        } catch (err) {
            console.error('Error loading user data:', err);
        }
    }
    
    next();
});
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96

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