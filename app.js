require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const flash = require('express-flash');
const expressLayouts = require('express-ejs-layouts');
const { pool } = require('./db');

const app = express();

/* ------------------ MIDDLEWARE ------------------ */
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
// app.use(async (req, res, next) => {
//   try {
//     if (req.session.userId) {
//       const [[user]] = await pool.execute(
//         `SELECT 
//           BIN_TO_UUID(u.id) AS id,
//           u.name,
//           u.role_id,
//           BIN_TO_UUID(u.shop_id) AS shop_id
//         FROM users u
//         WHERE u.id = UUID_TO_BIN(?)`,
//         [req.session.userId]
//       );



//       if (users.length > 0) {
//         const user = users[0];
//         res.locals.user = {
//           id: user.id,
//           username: user.name,
//           role: user.role,
//           shopId: user.shop_id
//         };

//         if (user.shop_id) {
//           const [shops] = await pool.execute(
//             'SELECT * FROM shops WHERE id = ?',
//             [user.shop_id]
//           );

//           if (shops.length > 0) {
//             const shop = shops[0];
//             // Override default shop data with actual shop data
//             res.locals.shop = {
//               id: shop.id,
//               name: shop.name || 'Manage Hub',
//               logo: shop.logo ? `/uploads/${shop.logo}` : '/images/default-logo.png',
//               phone: shop.phone || '+92 000000000',
//               address: shop.address || 'NextGenTech Solution, Quetta, Pakistan',
//               email: shop.email || 'NextGenTechSolution@gmail.com',
//               currency: shop.currency || 'PKR',
//               primary_color: shop.primary_color || '#007bff',
//               secondary_color: shop.secondary_color || '#6c757d'
//             };
//           }
//         }
//       }
//     }
//     next();
//   } catch (err) {
//     console.error('Error loading user/shop:', err);
//     next();
//   }
// });

/* ------------------ LOAD USER + SHOP ------------------ */
// app.use(async (req, res, next) => {
//   try {
//     if (req.session.userId) {
//       const [[user]] = await pool.execute(
//         `SELECT 
//           BIN_TO_UUID(u.id) AS id,
//           u.name,
//           u.role_id,
//           BIN_TO_UUID(u.shop_id) AS shop_id
//         FROM users u
//         WHERE u.id = UUID_TO_BIN(?)`,
//         [req.session.userId]
//       );

//       // FIX THIS PART - The variable name is wrong
//       if (user) { // Changed from 'users' to 'user'
//         res.locals.user = {
//           id: user.id,
//           username: user.name,
//           role: user.role_id,
//           shopId: user.shop_id
//         };

//         if (user.shop_id) {
//           const [shops] = await pool.execute(
//             `SELECT 
//               BIN_TO_UUID(id) AS id,
//               name,
//               logo,
//               phone,
//               address,
//               email,
//               currency,
//               primary_color,
//               secondary_color
//             FROM shops WHERE id = UUID_TO_BIN(?)`,
//             [user.shop_id]
//           );

//           if (shops.length > 0) {
//             const shop = shops[0];
//             // Override default shop data with actual shop data
//             res.locals.shop = {
//               id: shop.id,
//               name: shop.name || 'Manage Hub',
//               logo: shop.logo ? `/uploads/${shop.logo}` : '/images/default-logo.png',
//               phone: shop.phone || '+92 000000000',
//               address: shop.address || 'NextGenTech Solution, Quetta, Pakistan',
//               email: shop.email || 'NextGenTechSolution@gmail.com',
//               currency: shop.currency || 'PKR',
//               primary_color: shop.primary_color || '#007bff',
//               secondary_color: shop.secondary_color || '#6c757d'
//             };
//           }
//         }
//       }
//     }
//     next();
//   } catch (err) {
//     console.error('Error loading user/shop:', err);
//     next();
//   }
// });

/* ------------------ LOAD USER + SHOP ------------------ */
app.use(async (req, res, next) => {
  try {
    if (req.session.userId) {
      // Fetch user details
      const [users] = await pool.execute(
        `SELECT 
          BIN_TO_UUID(u.id) AS id,
          u.name,
          u.role_id,
          BIN_TO_UUID(u.shop_id) AS shop_id
        FROM users u
        WHERE u.id = UUID_TO_BIN(?)`,
        [req.session.userId]
      );

      if (users.length > 0) {
        const user = users[0];
        
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
            // Store shop in res.locals
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
      }
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
app.use('/raw', require('./routes/raw-materials'));
app.use('/admin', require('./routes/admin'));
app.use('/suppliers', require('./routes/suppliers'));

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