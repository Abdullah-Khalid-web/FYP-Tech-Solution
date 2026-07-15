const crypto = require('crypto');
const { sendEmail, getResetPasswordEmail, getPasswordResetSuccessEmail } = require('../config/email');
const { v4: uuidv4 } = require('uuid');

// Generate random token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/* SHOW FORGOT PASSWORD PAGE */
exports.showForgotPassword = (req, res) => {
  if (req.session?.userId) return res.redirect('/dashboard');
  res.render('auth/forget-password', { 
    title: 'Forgot Password', 
    error: null, 
    success: null 
  });
};

/* PROCESS FORGOT PASSWORD */
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.render('auth/forget-password', {
      title: 'Forgot Password',
      error: 'Email address is required',
      success: null
    });
  }

  try {
    // Check if user exists with this email
    const [users] = await pool.execute(
      `SELECT BIN_TO_UUID(u.id) as id, u.name, u.email, u.status 
       FROM users u 
       WHERE u.email = ?`,
      [email]
    );

    if (!users.length) {
      // Don't reveal if email exists for security
      return res.render('auth/forget-password', {
        title: 'Forgot Password',
        success: 'If an account exists with this email, you will receive a password reset link.',
        error: null
      });
    }

    const user = users[0];

    // Check if user is active
    if (user.status !== 'active') {
      return res.render('auth/forget-password', {
        title: 'Forgot Password',
        error: 'Your account is inactive. Please contact support.',
        success: null
      });
    }

    // Delete any existing reset tokens for this email
    await pool.execute(
      'DELETE FROM password_resets WHERE email = ? AND expires_at > NOW()',
      [email]
    );

    // Generate new token
    const token = generateToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // Token expires in 1 hour

    // Save token to database
    const resetId = uuidv4();
    await pool.execute(
      'INSERT INTO password_resets (id, email, token, expires_at, used) VALUES (UUID_TO_BIN(?), ?, ?, ?, 0)',
      [resetId, email, token, expiresAt]
    );

    // Generate reset link
    const resetLink = `${process.env.APP_URL || 'http://localhost:3000'}/reset-password/${token}`;

    // Send email
    const emailResult = await sendEmail(
      email,
      'Password Reset Request - ManageHub',
      getResetPasswordEmail(user.name, resetLink)
    );

    if (!emailResult.success) {
      console.error('Failed to send reset email:', emailResult.error);
      // Still show success message for security, but log the error
      console.error('Email sending failed for:', email);
    }

    // Show success message
    res.render('auth/forget-password', {
      title: 'Forgot Password',
      success: 'If an account exists with this email, you will receive a password reset link.',
      error: null
    });

  } catch (err) {
    console.error('Forgot password error:', err);
    res.render('auth/forget-password', {
      title: 'Forgot Password',
      error: 'Unable to process request. Please try again later.',
      success: null
    });
  }
};

/* SHOW RESET PASSWORD PAGE */
exports.showResetPassword = async (req, res) => {
  const { token } = req.params;

  if (req.session?.userId) return res.redirect('/dashboard');

  try {
    // Check if token is valid and not expired
    const [tokens] = await pool.execute(
      `SELECT * FROM password_resets 
       WHERE token = ? AND used = 0 AND expires_at > NOW()`,
      [token]
    );

    if (!tokens.length) {
      return res.render('auth/reset-password', {
        title: 'Reset Password',
        error: 'This password reset link is invalid or has expired.',
        success: null,
        token: null,
        valid: false
      });
    }

    // Valid token - show reset form
    res.render('auth/reset-password', {
      title: 'Reset Password',
      error: null,
      success: null,
      token: token,
      valid: true
    });

  } catch (err) {
    console.error('Show reset password error:', err);
    res.render('auth/reset-password', {
      title: 'Reset Password',
      error: 'Unable to verify reset link. Please try again.',
      success: null,
      token: null,
      valid: false
    });
  }
};

/* PROCESS RESET PASSWORD */
exports.resetPassword = async (req, res) => {
  const { token } = req.params;
  const { password, confirm_password } = req.body;

  // Validate passwords
  if (!password || !confirm_password) {
    return res.render('auth/reset-password', {
      title: 'Reset Password',
      error: 'Please fill in all fields',
      success: null,
      token: token,
      valid: true
    });
  }

  if (password !== confirm_password) {
    return res.render('auth/reset-password', {
      title: 'Reset Password',
      error: 'Passwords do not match',
      success: null,
      token: token,
      valid: true
    });
  }

  if (password.length < 6) {
    return res.render('auth/reset-password', {
      title: 'Reset Password',
      error: 'Password must be at least 6 characters long',
      success: null,
      token: token,
      valid: true
    });
  }

  try {
    // Verify token is valid
    const [tokens] = await pool.execute(
      `SELECT * FROM password_resets 
       WHERE token = ? AND used = 0 AND expires_at > NOW()`,
      [token]
    );

    if (!tokens.length) {
      return res.render('auth/reset-password', {
        title: 'Reset Password',
        error: 'This password reset link is invalid or has expired.',
        success: null,
        token: null,
        valid: false
      });
    }

    const resetRecord = tokens[0];
    const email = resetRecord.email;

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update user's password
    await pool.execute(
      'UPDATE users SET password = ?, updated_at = NOW() WHERE email = ?',
      [hashedPassword, email]
    );

    // Mark token as used
    await pool.execute(
      'UPDATE password_resets SET used = 1 WHERE token = ?',
      [token]
    );

    // Delete any other reset tokens for this email
    await pool.execute(
      'DELETE FROM password_resets WHERE email = ?',
      [email]
    );

    // Get user name for email
    const [users] = await pool.execute(
      'SELECT name FROM users WHERE email = ?',
      [email]
    );

    if (users.length) {
      // Send success email
      await sendEmail(
        email,
        'Password Changed Successfully - ManageHub',
        getPasswordResetSuccessEmail(users[0].name)
      );
    }

    // Show success message
    res.render('auth/reset-password', {
      title: 'Password Reset Success',
      error: null,
      success: 'Your password has been successfully reset. You can now login with your new password.',
      token: null,
      valid: false
    });

  } catch (err) {
    console.error('Reset password error:', err);
    res.render('auth/reset-password', {
      title: 'Reset Password',
      error: 'Unable to reset password. Please try again.',
      success: null,
      token: token,
      valid: true
    });
  }
};