const express = require('express');
const router = express.Router();
const { pool } = require('../../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Email configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

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

// Ensure password reset table exists
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
      INDEX idx_user_id (user_id),
      INDEX idx_expires_at (expires_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
}

// Send reset email function
async function sendResetEmail(email, name, resetLink) {
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset Request</title>
      <style>
        body {
          font-family: 'Plus Jakarta Sans', Arial, sans-serif;
          background-color: #f8fafc;
          margin: 0;
          padding: 0;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .card {
          background: #ffffff;
          border-radius: 16px;
          padding: 40px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          border: 1px solid #e2e8f0;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
        }
        .logo {
          font-size: 28px;
          font-weight: 800;
          color: #0f172a;
          text-decoration: none;
        }
        h2 {
          color: #0f172a;
          font-size: 24px;
          margin-bottom: 16px;
        }
        .content {
          color: #334155;
          line-height: 1.6;
        }
        .button {
          display: inline-block;
          background-color: #0f172a;
          color: #ffffff !important;
          text-decoration: none;
          padding: 12px 32px;
          border-radius: 8px;
          font-weight: 600;
          margin: 24px 0;
        }
        .button:hover {
          background-color: #1e293b;
        }
        .footer {
          text-align: center;
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #e2e8f0;
          font-size: 12px;
          color: #64748b;
        }
        .warning {
          background-color: #fef3c7;
          border-left: 4px solid #f59e0b;
          padding: 12px;
          margin: 20px 0;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="card">
          <div class="header">
            <div class="logo">ManageHub</div>
          </div>
          <h2>Password Reset Request</h2>
          <div class="content">
            <p>Hello ${name},</p>
            <p>We received a request to reset the password for your ManageHub account. Click the button below to create a new password:</p>
            
            <div style="text-align: center;">
              <a href="${resetLink}" class="button">Reset Password</a>
            </div>
            
            <div class="warning">
              <strong>⚠️ This link will expire in 1 hour</strong><br>
              If you didn't request this password reset, please ignore this email or contact support.
            </div>
            
            <p>If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="word-break: break-all; font-size: 12px; color: #64748b;">${resetLink}</p>
          </div>
          <div class="footer">
            <p>This is an automated message, please do not reply to this email.</p>
            <p>&copy; 2026 ManageHub. All rights reserved.</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"ManageHub" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Password Reset Request - ManageHub',
      html: emailHtml,
    });
    return { success: true, info };
  } catch (error) {
    console.error('Email sending error:', error);
    return { success: false, error: error.message };
  }
}

// Send password changed confirmation email
async function sendPasswordChangedEmail(email, name) {
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Password Changed Successfully</title>
      <style>
        body {
          font-family: 'Plus Jakarta Sans', Arial, sans-serif;
          background-color: #f8fafc;
          margin: 0;
          padding: 0;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .card {
          background: #ffffff;
          border-radius: 16px;
          padding: 40px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .success-icon {
          text-align: center;
          font-size: 64px;
          margin-bottom: 20px;
        }
        h2 {
          color: #0f172a;
          text-align: center;
        }
        .content {
          color: #334155;
          line-height: 1.6;
        }
        .footer {
          text-align: center;
          margin-top: 30px;
          font-size: 12px;
          color: #64748b;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="card">
          <div class="success-icon">✅</div>
          <h2>Password Changed Successfully</h2>
          <div class="content">
            <p>Hello ${name},</p>
            <p>Your ManageHub account password has been successfully changed.</p>
            <p>If you did not make this change, please contact our support team immediately.</p>
            <p>You can now log in to your account with your new password.</p>
          </div>
          <div class="footer">
            <p>&copy; 2026 ManageHub. All rights reserved.</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    await transporter.sendMail({
      from: `"ManageHub" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Password Changed Successfully - ManageHub',
      html: emailHtml,
    });
    return true;
  } catch (error) {
    console.error('Failed to send confirmation email:', error);
    return false;
  }
}

// GET - Login page
router.get('/login', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  res.render('auth/login', { 
    title: 'Login', 
    error: req.query.error || null, 
    success: req.query.success || null 
  });
});

// POST - Login
router.post('/login', async (req, res) => {
  console.log('Login attempt - req.body:', req.body);
  
  const { email, password, rememberMe } = req.body;
  
  if (!email || !password) {
    return res.render('auth/login', { 
      title: 'Login', 
      error: 'Email and password are required',
      success: null
    });
  }

  try {
    const [users] = await pool.execute(
      `SELECT 
        id, 
        name, 
        email, 
        password, 
        shop_id,
        status 
       FROM users 
       WHERE email = ? LIMIT 1`, 
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
    
    // Check if user is active
    if (user.status !== 'active') {
      return res.render('auth/login', { 
        title: 'Login', 
        error: 'Your account is inactive. Please contact support.',
        success: null
      });
    }
    
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
    req.session.userEmail = user.email;

    // Handle "remember me" if checkbox exists
    if (rememberMe) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    }

    console.log('Login successful for:', user.email);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    res.render('auth/login', { 
      title: 'Login', 
      error: 'Login failed. Please try again.',
      success: null
    });
  }
});

// GET - Forgot password page
router.get('/forgot-password', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  res.render('auth/forgot-password', { 
    title: 'Forgot Password', 
    error: null, 
    success: null 
  });
});

// POST - Forgot password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.render('auth/forgot-password', { 
      title: 'Forgot Password', 
      error: 'Email is required', 
      success: null 
    });
  }

  try {
    await ensurePasswordResetTable();
    
    // Get user details
    const [users] = await pool.execute(
      'SELECT BIN_TO_UUID(id) AS id, name, email, status FROM users WHERE email = ? LIMIT 1', 
      [email]
    );

    if (users.length) {
      const user = users[0];
      
      // Check if user is active
      if (user.status !== 'active') {
        return res.render('auth/forgot-password', { 
          title: 'Forgot Password', 
          error: 'Your account is inactive. Please contact support.', 
          success: null 
        });
      }
      
      // Delete any existing unused tokens for this user
      await pool.execute(
        'DELETE FROM password_reset_tokens WHERE user_id = UUID_TO_BIN(?) AND used_at IS NULL',
        [user.id]
      );
      
      // Generate new token
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1); // 1 hour expiry
      
      // Save token to database
      await pool.execute(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
         VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), ?, ?)`,
        [user.id, tokenHash, expiresAt]
      );

      // Generate reset URL
      const resetUrl = `${req.protocol}://${req.get('host')}/reset-password/${token}`;
      
      // Send email
      const emailResult = await sendResetEmail(user.email, user.name, resetUrl);
      
      if (!emailResult.success) {
        console.error('Failed to send reset email:', emailResult.error);
        // Still show success message for security
        return res.render('auth/forgot-password', {
          title: 'Forgot Password',
          error: null,
          success: 'If an account exists with this email, you will receive a password reset link shortly.'
        });
      }
      
      console.log(`Password reset email sent to: ${user.email}`);
    }

    // Always show success message (security best practice)
    res.render('auth/forgot-password', {
      title: 'Forgot Password',
      error: null,
      success: 'If an account exists with this email, you will receive a password reset link shortly.'
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.render('auth/forgot-password', { 
      title: 'Forgot Password', 
      error: 'Unable to process request. Please try again later.', 
      success: null 
    });
  }
});

// GET - Reset password page
router.get('/reset-password/:token', async (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  
  const { token } = req.params;
  
  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    const [tokens] = await pool.execute(
      `SELECT 
        t.used_at,
        t.expires_at,
        BIN_TO_UUID(t.user_id) as user_id
       FROM password_reset_tokens t
       WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );
    
    if (!tokens.length) {
      return res.render('auth/reset-password', {
        title: 'Reset Password',
        error: 'This password reset link is invalid or has expired.',
        token: null,
        valid: false
      });
    }
    
    // Valid token - show reset form
    res.render('auth/reset-password', {
      title: 'Reset Password',
      error: null,
      token: token,
      valid: true
    });
  } catch (err) {
    console.error('Reset password page error:', err);
    res.render('auth/reset-password', {
      title: 'Reset Password',
      error: 'Unable to verify reset link. Please try again.',
      token: null,
      valid: false
    });
  }
});

// POST - Reset password
router.post('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  const { password, confirmPassword } = req.body;
  
  // Validate passwords
  if (!password || password.length < 6) {
    return res.render('auth/reset-password', { 
      title: 'Reset Password', 
      error: 'Password must be at least 6 characters',
      token: token,
      valid: true
    });
  }
  
  if (password !== confirmPassword) {
    return res.render('auth/reset-password', { 
      title: 'Reset Password', 
      error: 'Passwords do not match',
      token: token,
      valid: true
    });
  }

  try {
    await ensurePasswordResetTable();
    
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    // Get valid token
    const [tokens] = await pool.execute(
      `SELECT 
        t.user_id,
        BIN_TO_UUID(t.user_id) as user_uuid,
        u.name,
        u.email
       FROM password_reset_tokens t
       JOIN users u ON t.user_id = u.id
       WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );

    if (!tokens.length) {
      return res.render('auth/reset-password', {
        title: 'Reset Password',
        error: 'This password reset link is invalid or has expired.',
        token: null,
        valid: false
      });
    }

    const tokenData = tokens[0];
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Update user password
    await pool.execute(
      'UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?',
      [hashedPassword, tokenData.user_id]
    );
    
    // Mark token as used
    await pool.execute(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = ?',
      [tokenHash]
    );
    
    // Delete any other unused tokens for this user
    await pool.execute(
      'DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL',
      [tokenData.user_id]
    );
    
    // Send confirmation email (don't wait for response)
    sendPasswordChangedEmail(tokenData.email, tokenData.name).catch(err => {
      console.error('Failed to send confirmation email:', err);
    });
    
    // Redirect to login with success message
    res.redirect('/login?success=Password reset successfully! Please login with your new password.');
  } catch (err) {
    console.error('Reset password error:', err);
    res.render('auth/reset-password', { 
      title: 'Reset Password', 
      error: 'Unable to reset password. Please try again.',
      token: token,
      valid: true
    });
  }
});

// GET - Logout
router.get('/logout', (req, res) => {
  const username = req.session?.username;
  
  req.session.destroy(err => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.clearCookie('connect.sid');
    console.log(`User logged out: ${username}`);
    res.redirect('/login');
  });
});

module.exports = router;