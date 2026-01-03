const bcrypt = require('bcryptjs');
const { pool } = require('../db');

/* SHOW LOGIN */
exports.showLogin = (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('auth/login', { title: 'Login', error: null });
};

/* LOGIN */
exports.login = async (req, res) => {
  const { name, password } = req.body;

  if (!name || !password) {
    return res.render('auth/login', {
      title: 'Login',
      error: 'Username and password required'
    });
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

    if (!match) {
      return res.render('auth/login', { title: 'Login', error: 'Invalid credentials' });
    }

    req.session.userId = user.id;       // BINARY(16) Buffer
    req.session.shopId = user.shop_id;  // BINARY(16) Buffer

    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.render('auth/login', {
      title: 'Login',
      error: 'Login failed'
    });
  }
};

/* SHOW LOGOUT PAGE */
exports.showLogout = (req, res) => {
  res.render('auth/logout', { title: 'Logout' });
};

/* LOGOUT */
exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('managehub.sid');
    res.redirect('/login');
  });
};
