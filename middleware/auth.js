// middleware/auth.js
const { pool } = require('../db');

/**
 * Middleware to check if user is logged in
 */
function isAuthenticated(req, res, next) {
  if (!req.session?.userId) {
    req.flash('error', 'Please login first.');
    return res.redirect('/login');
  }
  next();
}

/**
 * Middleware to check if user has a specific permission
 * @param {string} permissionSlug - permission slug from permissions table
 */
function hasPermission(permissionSlug) {
  return async (req, res, next) => {
    try {
      if (!req.session?.userId) {
        req.flash('error', 'Please login first.');
        return res.redirect('/login');
      }

      // Query the DB to check if user has the permission
      const [rows] = await pool.execute(
        `SELECT COUNT(*) AS allowed
         FROM users u
         JOIN role_permissions rp ON u.role_id = rp.role_id
         JOIN permissions p ON rp.permission_id = p.id
         WHERE u.id = UUID_TO_BIN(?) AND p.slug = ? AND p.status = 'active'`,
        [req.session.userId, permissionSlug]
      );

      if (rows[0].allowed) {
        return next(); // user has permission
      } else {
        // Check for individual user permissions
        const [userPermRows] = await pool.execute(
          `SELECT COUNT(*) AS allowed
           FROM user_permissions up
           JOIN permissions p ON up.permission_id = p.id
           WHERE up.user_id = UUID_TO_BIN(?) AND p.slug = ? AND p.status = 'active'`,
          [req.session.userId, permissionSlug]
        );
        
        if (userPermRows[0].allowed) {
          return next();
        }
        
        req.flash('error', 'You do not have permission to access this page.');
        return res.redirect('/dashboard');
      }
    } catch (err) {
      console.error('Permission check error:', err);
      return res.status(500).send('Internal Server Error');
    }
  };
}

module.exports = { isAuthenticated, hasPermission };