const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

// Middleware to protect routes
function isAuthenticated(req, res, next) {
  if (!req.session?.userId) return res.redirect('/login');
  next();
}

// Dashboard page
router.get('/dashboard', isAuthenticated, (req, res) => {
  // Get shop data from res.locals (already set by middleware)
  const shop = res.locals.shop || {
    name: 'Manage Hub',
    logo: '/images/default-logo.png',
    phone: '+92 000000000',
    address: 'NextGenTech Solution, Quetta, Pakistan',
    email: 'NextGenTechSolution@gmail.com',
    currency: 'PKR',
    primary_color: '#007bff',
    secondary_color: '#6c757d'
  };

  // Get user data from session/res.locals
  const user = {
    username: req.session.username || 'User',
    name: res.locals.user?.username || req.session.username || 'User'
  };

  res.render('dashboard', {
    title: 'Dashboard',
    user: user,
    shop: shop
  });
});

// API routes for dashboard data
router.get('/api/dashboard/stats', isAuthenticated, dashboardController.getStats);
router.get('/api/dashboard/recent-sales', isAuthenticated, dashboardController.getRecentSales);
router.get('/api/dashboard/low-stock', isAuthenticated, dashboardController.getLowStock);
router.get('/api/dashboard/sales-graph', isAuthenticated, dashboardController.getSalesGraph);

module.exports = router;