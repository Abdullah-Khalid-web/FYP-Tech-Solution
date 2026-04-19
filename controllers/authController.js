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
  }
};

/* LOGOUT */
exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('managehub.sid');
    res.redirect('/login');
  });
};
