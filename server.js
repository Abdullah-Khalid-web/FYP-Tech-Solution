require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const path = require('path');
const ejs = require('ejs');
const expressLayouts = require('express-ejs-layouts');
const { pool } = require('./db');
const app = express();
const flash = require('express-flash');

// Routers
const registerRouter = require('./routes/auth/register');
const productsRouter = require('./routes/products');
const billsRouter = require('./routes/bills');
const ALLbillsRouter = require('./routes/Allbills');
const EmpMgmtRouter = require('./routes/EmpMgmt');
const reportRouter = require('./routes/reports');
const inventoryRouter = require('./routes/inventory');
const userRouter = require('./routes/user');
const shopRouter = require('./routes/shop');
const alertRouter = require('./routes/alerts');
const expenseRouter = require('./routes/expenses');
const rawRouter = require('./routes/raw-materials');


// Middleware setup - ORDER IS IMPORTANT
app.use(flash());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'shopkeeper')));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 365 * 24 * 60 * 60 * 1000 // 10 years
  }
}));



app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// View engine setup
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layouts/layout');

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const dashboardRouter = require('./routes/dashboard');
app.use('/', dashboardRouter);

app.use((err, req, res, next) => {
    console.error(err.stack);
    
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ 
            success: false, 
            message: 'File upload error: ' + err.message 
        });
    }
    
    res.status(500).json({ 
        success: false, 
        message: 'Something went wrong!' 
    });
});

// Custom middleware - must come after session middleware
app.use((req, res, next) => {
  // Initialize default shop values
  res.locals.shop = {
    name: 'Retail System',
    logo: '/images/default-logo.png',
    phone: '+92 000000000',
    address: 'NExtGenTechSolution Quetta Pakistan',
    email: 'NExtGenTechSolution@gmail.com'
  };

  // Initialize empty user object
  res.locals.user = null;

  // Initialize empty error/success messages
  res.locals.error = null;
  res.locals.success = null;

  // Set default title
  res.locals.title = 'Retail System';

  next();
});

// Load user data middleware
app.use(async (req, res, next) => {
  try {
    if (req.session.userId) {
      const [users] = await pool.execute(
        'SELECT id, name, role, shop_id FROM users WHERE id = ?',
        [req.session.userId]
      );

      if (users.length > 0) {
        const user = users[0];
        res.locals.user = {
          id: user.id,
          username: user.name,
          role: user.role,
          shopId: user.shop_id
        };

        if (user.shop_id) {
          const [shops] = await pool.execute(
            'SELECT * FROM shops WHERE id = ?',
            [user.shop_id]
          );

          if (shops.length > 0) {
            res.locals.shop = {
              id: shops[0].id,
              name: shops[0].name || res.locals.shop.name, // Fixed: was shop_name should be name
              logo: shops[0].logo ? `/uploads/${shops[0].logo}` : res.locals.shop.logo,
              phone: shops[0].phone || res.locals.shop.phone,
              address: shops[0].address || res.locals.shop.address,
              email: shops[0].email || res.locals.shop.email
            };
          }
        }
      }
    }
    next();
  } catch (err) {
    console.error('Data loading middleware error:', err);
    next();
  }
});


// Middleware to get shop-specific table prefix and shop info
const getShopPrefix = async (req, res, next) => {
    if (!req.session.shopId) {
        return res.status(403).json({ success: false, message: 'Shop not identified' });
    }
    
    req.tablePrefix = `shop_${req.session.shopId}_`;
    
    try {
        // Get shop details from database
        const [shops] = await pool.execute(
            'SELECT * FROM shops WHERE id = ?',
            [req.session.shopId]
        );
        
        if (shops.length > 0) {
            req.shop = {
                id: shops[0].id,
                name: shops[0].name,
                logo: shops[0].logo ? `/uploads/${shops[0].logo}` : '/images/default-logo.png',
                phone: shops[0].phone,
                address: shops[0].address,
                email: shops[0].email,
                currency: shops[0].currency || 'PKR',
                primary_color: shops[0].primary_color || '#007bff',
                secondary_color: shops[0].secondary_color || '#6c757d'
            };
        } else {
            req.shop = {
                id: req.session.shopId,
                name: 'My Shop',
                logo: '/images/default-logo.png',
                phone: '',
                address: '',
                email: '',
                currency: 'PKR',
                primary_color: '#007bff',
                secondary_color: '#6c757d'
            };
        }
        
        next();
    } catch (err) {
        console.error('Error fetching shop details:', err);
        // Fallback to basic shop info if there's an error
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

// Routes - now registered after all middleware
app.use('/', registerRouter);
app.use('/products', productsRouter);
app.use('/bills', billsRouter);
app.use('/Allbills', ALLbillsRouter);
app.use('/EmpMgmt', EmpMgmtRouter);
app.use('/reports', reportRouter);
app.use('/inventory', inventoryRouter);
app.use('/user_profile', userRouter);
app.use('/shop_setting', shopRouter);
app.use('/alerts', alertRouter);
app.use('/expenses', expenseRouter);
app.use('/raw', rawRouter);

// Home 
app.get('/', (req, res) => {
  if (req.session.userId) {
    return res.render('dashboard.ejs');
  }

  res.render('index', { title: 'Home' });
});


app.get('/pricing', (req, res) => {
  res.render('pricing', { title: 'Pricing' });
});

// Log In
app.get('/login', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }
  res.render('auth/login', { // Changed to auth/login
    title: 'Login',
    error: null
  });
});

app.post('/login', async (req, res) => {
  const { name, password } = req.body;

  if (!name || !password) {
    return res.status(400).render('auth/login', { // Changed to auth/login
      title: 'Login',
      error: 'Username and password are required'
    });
  }

  try {
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE name = ?',
      [name]
    );

    if (users.length !== 1) {
      return res.status(401).render('auth/login', { // Changed to auth/login
        title: 'Login',
        error: 'Invalid credentials'
      });
    }

    const user = users[0];
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.status(401).render('auth/login', { // Changed to auth/login
        title: 'Login',
        error: 'Invalid credentials'
      });
    }

    req.session.regenerate((err) => {
      if (err) throw err;

      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.username = user.name;
      req.session.shopId = user.shop_id;

      const cookieOptions = {
        expires: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000), // 10 years
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
      };

      res.cookie('user_id', user.id, cookieOptions);
      res.cookie('username', user.name, cookieOptions);


      res.redirect('/');
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).render('auth/login', { // Changed to auth/login
      title: 'Login',
      error: 'An error occurred during login'
    });
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.redirect('/');
    }

    res.clearCookie('user_id');
    res.clearCookie('username');
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  const statusCode = err.status || 500;
  const message = err.message || 'Something went wrong!';

  if (req.originalUrl.startsWith('/api')) {
    return res.status(statusCode).json({
      error: true,
      message: message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  }

  res.status(statusCode).render('error', {
    title: 'Error',
    message: message,
    error: process.env.NODE_ENV === 'development' ? err : null
  });
});

// 404 handler
app.use((req, res) => {
  if (req.originalUrl.startsWith('/api')) {
    return res.status(404).json({
      error: true,
      message: 'Endpoint not found'
    });
  }

  res.status(404).render('404', {
    title: 'Page Not Found'
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});