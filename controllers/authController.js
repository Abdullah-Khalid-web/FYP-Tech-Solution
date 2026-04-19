const bcrypt = require('bcryptjs');
const { pool } = require('../db');

// Convert BINARY(16) to UUID string
function binToUuid(buffer) {
  if (!buffer) return null;
  const hex = buffer.toString('hex');
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32)
  ].join('-');
}

/* SHOW LOGIN */
exports.showLogin = (req, res) => {
  if (req.session?.userId) return res.redirect('/dashboard');
  res.render('auth/login', { title: 'Login', error: null });
};

/* LOGIN */
<<<<<<< HEAD
exports.login = async (req, res) => {
  const { name, password } = req.body;

  if (!name || !password) {
    return res.render('auth/login', { title: 'Login', error: 'Username and password are required' });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT id, name, password, shop_id FROM users WHERE name = ? LIMIT 1',
      [name]
    );

    if (!rows.length) {
      return res.render('auth/login', { title: 'Login', error: 'Invalid credentials' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.render('auth/login', { title: 'Login', error: 'Invalid credentials' });

    // Store UUID in session
    req.session.userId = binToUuid(user.id);
    req.session.shopId = user.shop_id ? binToUuid(user.shop_id) : null;
    req.session.username = user.name;

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    res.render('auth/login', { title: 'Login', error: 'Login failed' });
=======
// controllers/authController.js (login function)
exports.login = async (req, res) => {
  const { email, password, rememberMe } = req.body;

  if (!email || !password) {
    return res.render('auth/login', { 
      title: 'Login', 
      error: 'Email and password are required' 
    });
  }

  try {
    // Get user with role information
    const [rows] = await pool.execute(
      `SELECT 
        BIN_TO_UUID(u.id) as id,
        u.name,
        u.email,
        u.password,
        BIN_TO_UUID(u.shop_id) as shop_id,
        BIN_TO_UUID(u.role_id) as role_id,
        r.role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.email = ? LIMIT 1`,
      [email]
    );

    if (!rows.length) {
      return res.render('auth/login', { 
        title: 'Login', 
        error: 'Invalid email or password' 
      });
    }

    const user = rows[0];
    
    // Check if user is active
    const [statusCheck] = await pool.execute(
      'SELECT status FROM users WHERE email = ?',
      [email]
    );
    
    if (statusCheck.length && statusCheck[0].status !== 'active') {
      return res.render('auth/login', { 
        title: 'Login', 
        error: 'Your account is inactive. Please contact support.' 
      });
    }

    const match = await bcrypt.compare(password, user.password);
    
    if (!match) {
      return res.render('auth/login', { 
        title: 'Login', 
        error: 'Invalid email or password' 
      });
    }

    // Store ALL user info in session
    req.session.userId = user.id;
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role_id: user.role_id,
      role_name: user.role_name || 'No Role',
      shop_id: user.shop_id
    };
    req.session.shopId = user.shop_id;
    req.session.roleId = user.role_id;
    req.session.roleName = user.role_name || 'No Role';
    req.session.username = user.name;
    req.session.userEmail = user.email;

    // Set session expiry if "remember me" is checked
    if (rememberMe) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    }

    console.log('User logged in:', {
      id: user.id,
      name: user.name,
      role: user.role_name,
      shopId: user.shop_id
    });

    // Redirect to dashboard
    res.redirect('/dashboard');
    
  } catch (err) {
    console.error('Login error:', err);
    res.render('auth/login', { 
      title: 'Login', 
      error: 'Login failed. Please try again.' 
    });
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96
  }
};

/* LOGOUT */
exports.logout = (req, res) => {
<<<<<<< HEAD
  req.session.destroy(() => {
    res.clearCookie('managehub.sid');
    res.redirect('/login');
  });
};
=======
  const username = req.session?.username;
  
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.clearCookie('managehub.sid');
    console.log(`User logged out: ${username}`);
    res.redirect('/login');
  });
};



// <!-- In any EJS view -->
// <% if (await permission.hasPermission('products.create')) { %>
//     <a href="/products/create" class="btn btn-primary">Add Product</a>
// <% } %>

// <!-- Show/Hide based on permissions -->
// <% if (userPermissions?.byModule?.products) { %>
//     <div class="card">
//         <div class="card-header">Products</div>
//         <div class="card-body">
//             <!-- Product content -->
//         </div>
//     </div>
// <% } %>

// <!-- Conditional rendering based on multiple permissions -->
// <% if (await permission.hasAnyPermission(['products.edit', 'products.delete'])) { %>
//     <div class="btn-group">
//         <a href="/products/<%= product.id %>/edit" class="btn btn-sm btn-warning">Edit</a>
//         <a href="/products/<%= product.id %>/delete" class="btn btn-sm btn-danger">Delete</a>
//     </div>
// <% } %>
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96
