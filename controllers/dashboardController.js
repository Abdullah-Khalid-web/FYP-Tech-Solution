const { pool } = require('../db');

const MIN_STOCK = 5;

/* ===============================
   RENDER DASHBOARD PAGE
================================ */
exports.renderDashboard = async (req, res) => {
  try {
    res.render('dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Dashboard load failed');
  }
};

/* ===============================
   DASHBOARD STATS
================================ */
exports.getStats = async (req, res) => {
  try {
    const shopId = req.session.shopId || null;

    const [[products]] = await pool.execute(
      `SELECT COUNT(*) count FROM products 
       WHERE shop_id = UUID_TO_BIN(?)`,
      [shopId]
    );

    const [[employees]] = await pool.execute(
      `SELECT COUNT(*) count FROM users 
       WHERE shop_id = UUID_TO_BIN(?)`,
      [shopId]
    );

    const [[sales]] = await pool.execute(
      `SELECT IFNULL(SUM(total_amount),0) total
       FROM bills
       WHERE shop_id = UUID_TO_BIN(?)
       AND DATE(created_at) = CURDATE()`,
      [shopId]
    );

    const [[lowStock]] = await pool.execute(
      `SELECT COUNT(*) count
       FROM inventory
       WHERE shop_id = UUID_TO_BIN(?)
       AND current_quantity < ?`,
      [shopId, MIN_STOCK]
    );

    res.json({
      totalProducts: products.count,
      totalEmployees: employees.count,
      todaySales: sales.total,
      lowStockItems: lowStock.count
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Stats failed' });
  }
};

/* ===============================
   RECENT SALES
================================ */
exports.getRecentSales = async (req, res) => {
  try {
    const shopId = req.session.shopId || null;

    const [rows] = await pool.execute(
      `SELECT 
         BIN_TO_UUID(id) id,
         bill_number,
         total_amount,
         created_at
       FROM bills
       WHERE shop_id = UUID_TO_BIN(?)
       ORDER BY created_at DESC
       LIMIT 5`,
      [shopId]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Recent sales failed' });
  }
};

/* ===============================
   LOW STOCK
================================ */
exports.getLowStock = async (req, res) => {
  try {
    const shopId = req.session.shopId || null;

    const [rows] = await pool.execute(
      `SELECT 
         BIN_TO_UUID(p.id) id,
         p.name,
         i.current_quantity
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       WHERE i.shop_id = UUID_TO_BIN(?)
       AND i.current_quantity < ?
       ORDER BY i.current_quantity ASC
       LIMIT 5`,
      [shopId, MIN_STOCK]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Low stock failed' });
  }
};

/* ===============================
   SALES GRAPH (LAST 7 DAYS)
================================ */
exports.getSalesGraph = async (req, res) => {
  try {
    const shopId = req.session.shopId || null;

    const [rows] = await pool.execute(
      `SELECT 
         DATE(created_at) date,
         SUM(total_amount) total
       FROM bills
       WHERE shop_id = UUID_TO_BIN(?)
       AND created_at >= CURDATE() - INTERVAL 6 DAY
       GROUP BY DATE(created_at)
       ORDER BY date`,
      [shopId]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Graph failed' });
  }
};

/* ===============================
   DAILY SUMMARY
================================ */
exports.getDailySummary = async (req, res) => {
  try {
    const shopId = req.session.shopId || null;

    const [[sales]] = await pool.execute(
      `SELECT IFNULL(SUM(total_amount),0) as todaySales, COUNT(*) as totalTransactions
       FROM bills
       WHERE shop_id = UUID_TO_BIN(?) AND DATE(created_at) = CURDATE()`,
      [shopId]
    );

    const [topProducts] = await pool.execute(
      `SELECT p.name, SUM(bi.quantity) as quantity
       FROM bill_items bi
       JOIN bills b ON b.id = bi.bill_id
       JOIN products p ON p.id = bi.product_id
       WHERE b.shop_id = UUID_TO_BIN(?) AND DATE(b.created_at) = CURDATE()
       GROUP BY p.id
       ORDER BY quantity DESC LIMIT 5`,
      [shopId]
    );

    const [[lowStock]] = await pool.execute(
      `SELECT COUNT(*) as count FROM inventory i
       WHERE i.shop_id = UUID_TO_BIN(?) AND i.current_quantity < ?`,
      [shopId, MIN_STOCK]
    );

    res.json({
      todaySales: sales.todaySales,
      totalTransactions: sales.totalTransactions,
      topProducts: topProducts,
      lowStockItems: lowStock.count
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Daily summary failed' });
  }
};

/* ===============================
   ACTIVITY LOG
================================ */
exports.getActivity = async (req, res) => {
  // Mock activity to prevent 404s
  res.json([
    { type: 'sale', description: 'New sale recorded', timestamp: new Date() },
    { type: 'inventory', description: 'Stock updated', timestamp: new Date(Date.now() - 3600000) }
  ]);
};
