/**
 * AI Data Controller
 * Provides data endpoints that the AI module calls to fetch business data.
 * These are the endpoints referenced in the AI module's config.py API_ENDPOINTS.
 */

const { pool } = require('../db');

const MIN_STOCK = 5;

// =========================================================================
// Sales Endpoints
// =========================================================================

/**
 * GET /api/sales/daily
 * Returns today's total sales
 */
exports.getDailySales = async (req, res) => {
  try {
    const shopId = req.aiShopId || req.query.shop_id;
    if (!shopId) return res.status(400).json({ error: 'shop_id required' });

    const [[result]] = await pool.execute(
      `SELECT 
         IFNULL(SUM(total_amount), 0) AS total_sales,
         COUNT(*) AS transaction_count,
         CURDATE() AS date
       FROM bills
       WHERE shop_id = UUID_TO_BIN(?)
       AND DATE(created_at) = CURDATE()`,
      [shopId]
    );

    res.json(result);
  } catch (err) {
    console.error('[AI Data] getDailySales error:', err);
    res.status(500).json({ error: 'Failed to fetch daily sales' });
  }
};

/**
 * GET /api/sales/weekly
 * Returns this week's total sales
 */
exports.getWeeklySales = async (req, res) => {
  try {
    const shopId = req.aiShopId || req.query.shop_id;
    if (!shopId) return res.status(400).json({ error: 'shop_id required' });

    const [[result]] = await pool.execute(
      `SELECT 
         IFNULL(SUM(total_amount), 0) AS total_sales,
         COUNT(*) AS transaction_count,
         'current_week' AS period
       FROM bills
       WHERE shop_id = UUID_TO_BIN(?)
       AND YEARWEEK(created_at, 1) = YEARWEEK(CURDATE(), 1)`,
      [shopId]
    );

    // Also get daily breakdown
    const [daily] = await pool.execute(
      `SELECT 
         DATE(created_at) AS date,
         SUM(total_amount) AS total,
         COUNT(*) AS transactions
       FROM bills
       WHERE shop_id = UUID_TO_BIN(?)
       AND created_at >= CURDATE() - INTERVAL 6 DAY
       GROUP BY DATE(created_at)
       ORDER BY date`,
      [shopId]
    );

    res.json({ ...result, daily_breakdown: daily });
  } catch (err) {
    console.error('[AI Data] getWeeklySales error:', err);
    res.status(500).json({ error: 'Failed to fetch weekly sales' });
  }
};

/**
 * GET /api/sales/monthly
 * Returns this month's total sales
 */
exports.getMonthlySales = async (req, res) => {
  try {
    const shopId = req.aiShopId || req.query.shop_id;
    if (!shopId) return res.status(400).json({ error: 'shop_id required' });

    const [[result]] = await pool.execute(
      `SELECT 
         IFNULL(SUM(total_amount), 0) AS total_sales,
         COUNT(*) AS transaction_count,
         DATE_FORMAT(CURDATE(), '%Y-%m') AS month
       FROM bills
       WHERE shop_id = UUID_TO_BIN(?)
       AND MONTH(created_at) = MONTH(CURDATE())
       AND YEAR(created_at) = YEAR(CURDATE())`,
      [shopId]
    );

    res.json(result);
  } catch (err) {
    console.error('[AI Data] getMonthlySales error:', err);
    res.status(500).json({ error: 'Failed to fetch monthly sales' });
  }
};

/**
 * GET /api/sales/top-sellers
 * Returns top selling products
 */
exports.getTopSellers = async (req, res) => {
  try {
    const shopId = req.aiShopId || req.query.shop_id;
    const limit = parseInt(req.query.limit) || 10;
    if (!shopId) return res.status(400).json({ error: 'shop_id required' });

    const [items] = await pool.execute(
      `SELECT 
         p.name,
         SUM(bi.quantity) AS qty_sold,
         SUM(bi.total_price) AS revenue
       FROM bill_items bi
       JOIN products p ON p.id = bi.product_id
       JOIN bills b ON b.id = bi.bill_id
       WHERE b.shop_id = UUID_TO_BIN(?)
       AND b.created_at >= CURDATE() - INTERVAL 30 DAY
       GROUP BY p.id, p.name
       ORDER BY qty_sold DESC
       LIMIT ?`,
      [shopId, limit]
    );

    res.json({ items });
  } catch (err) {
    console.error('[AI Data] getTopSellers error:', err);
    res.status(500).json({ error: 'Failed to fetch top sellers' });
  }
};

/**
 * GET /api/sales/transactions
 * Returns recent transactions
 */
exports.getTransactions = async (req, res) => {
  try {
    const shopId = req.aiShopId || req.query.shop_id;
    const date = req.query.date || new Date().toISOString().split('T')[0];
    if (!shopId) return res.status(400).json({ error: 'shop_id required' });

    const [rows] = await pool.execute(
      `SELECT 
         BIN_TO_UUID(b.id) AS id,
         b.bill_number,
         b.total_amount,
         b.discount,
         b.payment_method,
         b.created_at,
         BIN_TO_UUID(b.created_by) AS cashier_id
       FROM bills b
       WHERE b.shop_id = UUID_TO_BIN(?)
       AND DATE(b.created_at) = ?
       ORDER BY b.created_at DESC
       LIMIT 50`,
      [shopId, date]
    );

    res.json({ transactions: rows });
  } catch (err) {
    console.error('[AI Data] getTransactions error:', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
};

// =========================================================================
// Product / Inventory Endpoints
// =========================================================================

/**
 * GET /api/products (for AI)
 * Returns all products with optional search
 */
exports.getProducts = async (req, res) => {
  try {
    const shopId = req.aiShopId || req.query.shop_id;
    const search = req.query.q || req.query.name || '';
    if (!shopId) return res.status(400).json({ error: 'shop_id required' });

    let query = `
      SELECT 
        BIN_TO_UUID(p.id) AS id,
        p.name, p.brand, p.category, p.size, p.barcode,
        i.current_quantity, i.selling_price, i.avg_cost
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id AND i.shop_id = p.shop_id
      WHERE p.shop_id = UUID_TO_BIN(?)`;
    const params = [shopId];

    if (search) {
      query += ` AND LOWER(p.name) LIKE ?`;
      params.push(`%${search.toLowerCase()}%`);
    }

    query += ` ORDER BY p.name LIMIT 50`;

    const [rows] = await pool.execute(query, params);
    res.json({ products: rows });
  } catch (err) {
    console.error('[AI Data] getProducts error:', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
};

/**
 * GET /api/products/low-stock
 * Returns products below minimum stock threshold
 */
exports.getLowStock = async (req, res) => {
  try {
    const shopId = req.aiShopId || req.query.shop_id;
    if (!shopId) return res.status(400).json({ error: 'shop_id required' });

    const [items] = await pool.execute(
      `SELECT 
         BIN_TO_UUID(p.id) AS id,
         p.name,
         i.current_quantity AS current,
         ? AS min_threshold,
         i.selling_price
       FROM products p
       JOIN inventory i ON i.product_id = p.id AND i.shop_id = p.shop_id
       WHERE p.shop_id = UUID_TO_BIN(?)
       AND i.current_quantity < ?
       ORDER BY i.current_quantity ASC`,
      [MIN_STOCK, shopId, MIN_STOCK]
    );

    res.json({ items });
  } catch (err) {
    console.error('[AI Data] getLowStock error:', err);
    res.status(500).json({ error: 'Failed to fetch low stock items' });
  }
};

/**
 * GET /api/products/:id/stock
 * Returns stock level for a specific product
 */
exports.getProductStock = async (req, res) => {
  try {
    const shopId = req.aiShopId || req.query.shop_id;
    const productId = req.params.id;
    if (!shopId) return res.status(400).json({ error: 'shop_id required' });

    const [[result]] = await pool.execute(
      `SELECT 
         p.name AS product,
         i.current_quantity AS current_stock,
         ? AS min_threshold,
         CASE WHEN i.current_quantity < ? THEN 'low_stock' ELSE 'in_stock' END AS status,
         i.selling_price
       FROM products p
       JOIN inventory i ON i.product_id = p.id AND i.shop_id = p.shop_id
       WHERE p.id = UUID_TO_BIN(?) AND p.shop_id = UUID_TO_BIN(?)`,
      [MIN_STOCK, MIN_STOCK, productId, shopId]
    );

    if (!result) return res.status(404).json({ error: 'Product not found' });
    res.json(result);
  } catch (err) {
    console.error('[AI Data] getProductStock error:', err);
    res.status(500).json({ error: 'Failed to fetch product stock' });
  }
};

// =========================================================================
// Report Endpoints
// =========================================================================

/**
 * GET /api/reports/daily
 */
exports.getDailyReport = async (req, res) => {
  try {
    const shopId = req.aiShopId || req.query.shop_id;
    if (!shopId) return res.status(400).json({ error: 'shop_id required' });

    // Sales summary
    const [[sales]] = await pool.execute(
      `SELECT 
         IFNULL(SUM(total_amount), 0) AS total_sales,
         COUNT(*) AS total_bills,
         IFNULL(AVG(total_amount), 0) AS avg_bill,
         IFNULL(SUM(discount), 0) AS total_discounts
       FROM bills
       WHERE shop_id = UUID_TO_BIN(?) AND DATE(created_at) = CURDATE()`,
      [shopId]
    );

    // Expenses
    const [[expenses]] = await pool.execute(
      `SELECT IFNULL(SUM(amount), 0) AS total_expenses
       FROM expenses
       WHERE shop_id = UUID_TO_BIN(?) AND expense_date = CURDATE()`,
      [shopId]
    );

    // Low stock count
    const [[lowStock]] = await pool.execute(
      `SELECT COUNT(*) AS count
       FROM inventory WHERE shop_id = UUID_TO_BIN(?) AND current_quantity < ?`,
      [shopId, MIN_STOCK]
    );

    res.json({
      summary: 'Daily report',
      total_sales: sales.total_sales,
      total_bills: sales.total_bills,
      avg_bill: sales.avg_bill,
      total_discounts: sales.total_discounts,
      total_expenses: expenses.total_expenses,
      net_profit: sales.total_sales - expenses.total_expenses,
      low_stock_items: lowStock.count,
      alerts: lowStock.count > 0 ? [`${lowStock.count} items are low on stock`] : [],
    });
  } catch (err) {
    console.error('[AI Data] getDailyReport error:', err);
    res.status(500).json({ error: 'Failed to generate daily report' });
  }
};

/**
 * GET /api/reports/weekly
 */
exports.getWeeklyReport = async (req, res) => {
  try {
    const shopId = req.aiShopId || req.query.shop_id;
    if (!shopId) return res.status(400).json({ error: 'shop_id required' });

    const [[sales]] = await pool.execute(
      `SELECT 
         IFNULL(SUM(total_amount), 0) AS total_sales,
         COUNT(*) AS total_bills
       FROM bills
       WHERE shop_id = UUID_TO_BIN(?)
       AND created_at >= CURDATE() - INTERVAL 6 DAY`,
      [shopId]
    );

    const [[expenses]] = await pool.execute(
      `SELECT IFNULL(SUM(amount), 0) AS total_expenses
       FROM expenses
       WHERE shop_id = UUID_TO_BIN(?)
       AND expense_date >= CURDATE() - INTERVAL 6 DAY`,
      [shopId]
    );

    // Top products this week
    const [topProducts] = await pool.execute(
      `SELECT p.name, SUM(bi.quantity) AS qty
       FROM bill_items bi
       JOIN products p ON p.id = bi.product_id
       JOIN bills b ON b.id = bi.bill_id
       WHERE b.shop_id = UUID_TO_BIN(?)
       AND b.created_at >= CURDATE() - INTERVAL 6 DAY
       GROUP BY p.id, p.name
       ORDER BY qty DESC LIMIT 5`,
      [shopId]
    );

    res.json({
      summary: 'Weekly report',
      total_sales: sales.total_sales,
      total_bills: sales.total_bills,
      total_expenses: expenses.total_expenses,
      net_profit: sales.total_sales - expenses.total_expenses,
      top_products: topProducts.map(p => p.name),
      alerts: [],
    });
  } catch (err) {
    console.error('[AI Data] getWeeklyReport error:', err);
    res.status(500).json({ error: 'Failed to generate weekly report' });
  }
};

/**
 * GET /api/reports/expenses
 */
exports.getExpenseReport = async (req, res) => {
  try {
    const shopId = req.aiShopId || req.query.shop_id;
    if (!shopId) return res.status(400).json({ error: 'shop_id required' });

    const [rows] = await pool.execute(
      `SELECT 
         category,
         SUM(amount) AS total,
         COUNT(*) AS count
       FROM expenses
       WHERE shop_id = UUID_TO_BIN(?)
       AND expense_date >= CURDATE() - INTERVAL 30 DAY
       GROUP BY category
       ORDER BY total DESC`,
      [shopId]
    );

    const [[total]] = await pool.execute(
      `SELECT IFNULL(SUM(amount), 0) AS grand_total
       FROM expenses
       WHERE shop_id = UUID_TO_BIN(?)
       AND expense_date >= CURDATE() - INTERVAL 30 DAY`,
      [shopId]
    );

    res.json({
      categories: rows,
      grand_total: total.grand_total,
      period: 'last_30_days',
    });
  } catch (err) {
    console.error('[AI Data] getExpenseReport error:', err);
    res.status(500).json({ error: 'Failed to fetch expense report' });
  }
};

// =========================================================================
// Analytics Endpoints
// =========================================================================

/**
 * GET /api/analytics/sales-trend
 */
exports.getSalesTrend = async (req, res) => {
  try {
    const shopId = req.aiShopId || req.query.shop_id;
    const period = req.query.period || 'weekly';
    if (!shopId) return res.status(400).json({ error: 'shop_id required' });

    let interval, prevInterval;
    if (period === 'daily') {
      interval = 'INTERVAL 1 DAY';
      prevInterval = 'INTERVAL 2 DAY';
    } else if (period === 'monthly') {
      interval = 'INTERVAL 30 DAY';
      prevInterval = 'INTERVAL 60 DAY';
    } else {
      interval = 'INTERVAL 7 DAY';
      prevInterval = 'INTERVAL 14 DAY';
    }

    const [[current]] = await pool.execute(
      `SELECT IFNULL(SUM(total_amount), 0) AS total
       FROM bills
       WHERE shop_id = UUID_TO_BIN(?)
       AND created_at >= CURDATE() - ${interval}`,
      [shopId]
    );

    const [[previous]] = await pool.execute(
      `SELECT IFNULL(SUM(total_amount), 0) AS total
       FROM bills
       WHERE shop_id = UUID_TO_BIN(?)
       AND created_at >= CURDATE() - ${prevInterval}
       AND created_at < CURDATE() - ${interval}`,
      [shopId]
    );

    const currentTotal = current.total;
    const previousTotal = previous.total;
    const change = previousTotal > 0
      ? ((currentTotal - previousTotal) / previousTotal * 100).toFixed(1)
      : 0;

    res.json({
      trend: currentTotal >= previousTotal ? 'up' : 'down',
      percentage: parseFloat(change),
      current_total: currentTotal,
      previous_total: previousTotal,
      period: `vs_last_${period}`,
    });
  } catch (err) {
    console.error('[AI Data] getSalesTrend error:', err);
    res.status(500).json({ error: 'Failed to calculate sales trend' });
  }
};

/**
 * GET /api/analytics/anomalies
 */
exports.getAnomalies = async (req, res) => {
  try {
    const shopId = req.aiShopId || req.query.shop_id;
    if (!shopId) return res.status(400).json({ error: 'shop_id required' });

    // Find bills with unusually high discounts (>30% of subtotal)
    const [highDiscounts] = await pool.execute(
      `SELECT 
         BIN_TO_UUID(id) AS bill_id,
         bill_number,
         subtotal,
         discount,
         total_amount,
         ROUND(discount / subtotal * 100, 1) AS discount_pct,
         created_at
       FROM bills
       WHERE shop_id = UUID_TO_BIN(?)
       AND subtotal > 0
       AND discount / subtotal > 0.3
       AND created_at >= CURDATE() - INTERVAL 7 DAY
       ORDER BY discount_pct DESC
       LIMIT 10`,
      [shopId]
    );

    res.json({
      anomalies: highDiscounts.map(d => ({
        type: 'high_discount',
        severity: d.discount_pct > 50 ? 'high' : 'medium',
        description: `Bill ${d.bill_number}: ${d.discount_pct}% discount applied`,
        bill_id: d.bill_id,
        data: d,
      })),
      total_found: highDiscounts.length,
    });
  } catch (err) {
    console.error('[AI Data] getAnomalies error:', err);
    res.status(500).json({ error: 'Failed to fetch anomalies' });
  }
};

// =========================================================================
// Staff Endpoints
// =========================================================================

/**
 * GET /api/users/performance
 */
exports.getStaffPerformance = async (req, res) => {
  try {
    const shopId = req.aiShopId || req.query.shop_id;
    if (!shopId) return res.status(400).json({ error: 'shop_id required' });

    const [rows] = await pool.execute(
      `SELECT 
         BIN_TO_UUID(u.id) AS user_id,
         u.name,
         COUNT(b.id) AS bills_processed,
         IFNULL(SUM(b.total_amount), 0) AS total_sales,
         IFNULL(AVG(b.total_amount), 0) AS avg_sale
       FROM users u
       LEFT JOIN bills b ON b.created_by = u.id 
         AND b.created_at >= CURDATE() - INTERVAL 7 DAY
       WHERE u.shop_id = UUID_TO_BIN(?)
       AND u.status = 'active'
       GROUP BY u.id, u.name
       ORDER BY total_sales DESC`,
      [shopId]
    );

    res.json({ staff: rows });
  } catch (err) {
    console.error('[AI Data] getStaffPerformance error:', err);
    res.status(500).json({ error: 'Failed to fetch staff performance' });
  }
};

/**
 * GET /api/users
 * Returns list of staff members
 */
exports.getStaffList = async (req, res) => {
  try {
    const shopId = req.aiShopId || req.query.shop_id;
    const roleId = req.query.role || '';
    if (!shopId) return res.status(400).json({ error: 'shop_id required' });

    let query = `
      SELECT 
         BIN_TO_UUID(u.id) AS user_id,
         u.name,
         u.role_id,
         u.email,
         u.status
       FROM users u
       WHERE u.shop_id = UUID_TO_BIN(?)
       AND u.status = 'active'
    `;
    const params = [shopId];

    if (roleId) {
      query += ` AND LOWER(u.role_id) LIKE ?`;
      params.push(`%${roleId.toLowerCase()}%`);
    }

    const [rows] = await pool.execute(query, params);
    res.json({ staff: rows, count: rows.length });
  } catch (err) {
    console.error('[AI Data] getStaffList error:', err);
    res.status(500).json({ error: 'Failed to fetch staff list' });
  }
};
