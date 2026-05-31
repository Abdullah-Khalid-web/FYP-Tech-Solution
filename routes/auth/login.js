const express = require('express');
const router = express.Router();
const { pool } = require('../../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

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

router.get('/login', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  res.render('auth/login', { title: 'Login', error: null, success: req.query.success || null });
});

async function ensurePasswordResetTable() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id BINARY(16) PRIMARY KEY,
      user_id BINARY(16) NOT NULL,
      token_hash VARCHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_token_hash (token_hash),
      INDEX idx_user_id (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
}

router.get('/forgot-password', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  res.render('auth/forgot-password', { title: 'Forgot Password', error: null, success: null });
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.render('auth/forgot-password', { title: 'Forgot Password', error: 'Email is required', success: null });
  }

  try {
    await ensurePasswordResetTable();
    const [users] = await pool.execute('SELECT BIN_TO_UUID(id) AS id, email FROM users WHERE email = ? LIMIT 1', [email]);

    if (users.length) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await pool.execute(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
         VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))`,
        [users[0].id, tokenHash]
      );

      const resetUrl = `${req.protocol}://${req.get('host')}/reset-password/${token}`;
      console.log(`Password reset link for ${email}: ${resetUrl}`);
    }

    res.render('auth/forgot-password', {
      title: 'Forgot Password',
      error: null,
      success: 'If that email exists, a reset link has been generated. Check the server console or configured mail logs.'
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.render('auth/forgot-password', { title: 'Forgot Password', error: 'Unable to start password reset', success: null });
  }
});

router.get('/reset-password/:token', async (req, res) => {
  res.render('auth/reset-password', { title: 'Reset Password', token: req.params.token, error: null });
});

router.post('/reset-password/:token', async (req, res) => {
  const { password, confirmPassword } = req.body;
  const tokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex');

  if (!password || password.length < 6) {
    return res.render('auth/reset-password', { title: 'Reset Password', token: req.params.token, error: 'Password must be at least 6 characters' });
  }
  if (password !== confirmPassword) {
    return res.render('auth/reset-password', { title: 'Reset Password', token: req.params.token, error: 'Passwords do not match' });
  }

  try {
    await ensurePasswordResetTable();
    const [tokens] = await pool.execute(
      `SELECT BIN_TO_UUID(user_id) AS user_id
       FROM password_reset_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [tokenHash]
    );

    if (!tokens.length) {
      return res.render('auth/reset-password', { title: 'Reset Password', token: req.params.token, error: 'Reset link is invalid or expired' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.execute('UPDATE users SET password = ?, updated_at = NOW() WHERE id = UUID_TO_BIN(?)', [hashedPassword, tokens[0].user_id]);
    await pool.execute('UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = ?', [tokenHash]);

    res.redirect('/login?success=Password reset successfully. Please sign in.');
  } catch (err) {
    console.error('Reset password error:', err);
    res.render('auth/reset-password', { title: 'Reset Password', token: req.params.token, error: 'Unable to reset password' });
  }
});

router.post('/login', async (req, res) => {

  console.log('Login attempt - req.body:', req.body); // Debug log
  
  const { email, password } = req.body; // Changed from 'name' to 'email'
  
  if (!email || !password) {
    return res.render('auth/login', { 
      title: 'Login', 
      error: 'Email and password are required',
      success: null
    });
  }

  try {
    // Changed from 'name' to 'email' in query
    const [users] = await pool.execute(
      'SELECT id, name, email, password, shop_id FROM users WHERE email = ? LIMIT 1', 
      [email]
    );
    
    if (!users.length) {
      return res.render('auth/login', { 
        title: 'Login', 
        error: 'Invalid email or password',
        success: null
      });
    }

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password);
    
    if (!valid) {
      return res.render('auth/login', { 
        title: 'Login', 
        error: 'Invalid email or password',
        success: null
      });
    }

    // Store in session
    req.session.userId = binToUuid(user.id);
    req.session.shopId = user.shop_id ? binToUuid(user.shop_id) : null;
    req.session.username = user.name;
    req.session.userEmail = user.email; // Store email too

    // Handle "remember me" if checkbox exists
    if (req.body.rememberMe) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    }

    console.log('Login successful for:', user.email);
    res.redirect('/dashboard'); // Make sure this route exists
  } catch (err) {
    console.error('Login error:', err);
    res.render('auth/login', { 
      title: 'Login', 
      error: 'Login failed. Please try again.',
      success: null
    });
  }
});

module.exports = router;
