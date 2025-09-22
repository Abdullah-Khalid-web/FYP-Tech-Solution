// routes/dashboard.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

const minimum_stock = 10; // Example minimum stock threshold

// Dashboard API Routes
router.get('/api/dashboard/stats', async (req, res) => {
  try {
    const shopId = req.session.shopId;
    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const productsTable = `shop_${shopId}_products`;
    const salesTable = `shop_${shopId}_bills`;
    const usersTable = `users`; // Assuming `users` table is shared

    // Query product count
    const [products] = await pool.execute(`SELECT COUNT(*) as count FROM \`${productsTable}\``);

    // Query employee count
    const [employees] = await pool.execute(
      `SELECT COUNT(*) as count FROM \`${usersTable}\` WHERE role = 'employee' AND shop_id = ?`,
      [shopId]
    );

    // Today's sales
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [todaySales] = await pool.execute(
      `SELECT SUM(total_amount) as total FROM \`${salesTable}\` WHERE created_at >= ?`,
      [startOfDay]
    );
    // Low stock
    const [lowStockItems] = await pool.execute(
      `SELECT COUNT(*) as count FROM \`${productsTable}\` WHERE quantity < ${minimum_stock}`
    );

    res.json({
      totalProducts: products[0].count,
      todaySales: todaySales[0].total || 0,
      totalEmployees: employees[0].count,
      lowStockItems: lowStockItems[0].count
    });

  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Failed to load dashboard stats' });
  }
});

router.get('/api/dashboard/recent-sales', async (req, res) => {
  try {
    const shopId = req.session.shopId; // Add this line to get shopId from session
    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const salesTable = `shop_${shopId}_bills`;
    const [recentSales] = await pool.execute(
      `SELECT id, total_amount as totalAmount, created_at as createdAt FROM \`${salesTable}\` ORDER BY created_at DESC LIMIT 5`
    );

    res.json(recentSales);
  } catch (error) {
    console.error('Error fetching recent sales:', error);
    res.status(500).json({ error: 'Failed to load recent sales' });
  }
});

router.get('/api/dashboard/low-stock', async (req, res) => {
  try {
    const shopId = req.session.shopId; // Add this line to get shopId from session
    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const productsTable = `shop_${shopId}_products`;
    const [lowStockItems] = await pool.execute(
      `SELECT id, name, quantity as currentStock FROM \`${productsTable}\` WHERE quantity < ${minimum_stock} ORDER BY quantity ASC LIMIT 5`
    );

    res.json(lowStockItems);
  } catch (error) {
    console.error('Error fetching low stock items:', error);
    res.status(500).json({ error: 'Failed to load low stock items' });
  }
});

// ... rest of your code remains the same
router.get('/api/dashboard/activity', async (req, res) => {
  try {
    // In a real app, you would query an activities table
    // For now, we'll simulate some recent activities
    const activities = [
      {
        type: 'sale',
        description: 'New sale completed - Order #1254',
        timestamp: new Date(Date.now() - 10 * 60 * 1000) // 10 minutes ago
      },
      {
        type: 'inventory',
        description: 'Product "iPhone 13" added to inventory',
        timestamp: new Date(Date.now() - 25 * 60 * 1000) // 25 minutes ago
      },
      {
        type: 'employee',
        description: 'New employee "Rahul Sharma" added',
        timestamp: new Date(Date.now() - 60 * 60 * 1000) // 1 hour ago
      },
      {
        type: 'alert',
        description: 'Low stock alert for Apple AirPods Pro',
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
      }
    ];

    res.json(activities);
  } catch (error) {
    console.error('Error fetching activity:', error);
    res.status(500).json({ error: 'Failed to load activity' });
  }
});

module.exports = router;