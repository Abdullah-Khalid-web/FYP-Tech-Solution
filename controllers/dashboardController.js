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
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       WHERE i.shop_id = UUID_TO_BIN(?)
       AND i.current_quantity < ?`,
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
   RECENT SALES (FIXED)
================================ */
exports.getRecentSales = async (req, res) => {
  try {
    const shopId = req.session.shopId || null;

    const [rows] = await pool.execute(
      `SELECT 
         BIN_TO_UUID(b.id) as id,
         b.bill_number,
         b.total_amount,
         b.created_at,
         b.customer_name
       FROM bills b
       WHERE b.shop_id = UUID_TO_BIN(?)
       ORDER BY b.created_at DESC
       LIMIT 5`,
      [shopId]
    );

    // Format the response
    const formattedRows = rows.map(row => ({
      id: row.id,
      bill_number: row.bill_number,
      totalAmount: parseFloat(row.total_amount),
      createdAt: row.created_at,
      customer_name: row.customer_name || 'Walk-in Customer'
    }));

    res.json(formattedRows);
  } catch (err) {
    console.error('Error fetching recent sales:', err);
    res.status(500).json({ error: 'Recent sales failed', details: err.message });
  }
};

/* ===============================
   LOW STOCK (FIXED)
================================ */
exports.getLowStock = async (req, res) => {
  try {
    const shopId = req.session.shopId || null;

    const [rows] = await pool.execute(
      `SELECT 
         BIN_TO_UUID(p.id) as id,
         p.name,
         COALESCE(i.current_quantity, 0) as current_quantity,
         p.sku
       FROM products p
       LEFT JOIN inventory i ON p.id = i.product_id
       WHERE p.shop_id = UUID_TO_BIN(?)
       AND COALESCE(i.current_quantity, 0) < ?
       ORDER BY COALESCE(i.current_quantity, 0) ASC
       LIMIT 5`,
      [shopId, MIN_STOCK]
    );

    res.json(rows);
  } catch (err) {
    console.error('Error fetching low stock:', err);
    res.status(500).json({ error: 'Low stock failed', details: err.message });
  }
};

/* ===============================
   SALES GRAPH (FIXED WITH DATE RANGE)
================================ */
exports.getSalesGraph = async (req, res) => {
  try {
    const shopId = req.session.shopId || null;
    const { days = 7, startDate, endDate, type = 'sales' } = req.query;

    let query = '';
    let params = [shopId];

    if (startDate && endDate) {
      // Custom date range
      switch(type) {
        case 'expenses':
          query = `
            SELECT 
              DATE(expense_date) as date,
              COALESCE(SUM(amount), 0) as total
            FROM expenses
            WHERE shop_id = UUID_TO_BIN(?)
            AND expense_date BETWEEN ? AND ?
            GROUP BY DATE(expense_date)
            ORDER BY date
          `;
          params.push(startDate, endDate);
          break;
          
        case 'users':
          query = `
            SELECT 
              DATE(created_at) as date,
              COUNT(*) as total
            FROM users
            WHERE shop_id = UUID_TO_BIN(?)
            AND created_at BETWEEN ? AND ?
            GROUP BY DATE(created_at)
            ORDER BY date
          `;
          params.push(startDate, endDate);
          break;
          
        case 'products':
          query = `
            SELECT 
              DATE(created_at) as date,
              COUNT(*) as total
            FROM products
            WHERE shop_id = UUID_TO_BIN(?)
            AND created_at BETWEEN ? AND ?
            GROUP BY DATE(created_at)
            ORDER BY date
          `;
          params.push(startDate, endDate);
          break;
          
        case 'suppliers':
          query = `
            SELECT 
              DATE(created_at) as date,
              COUNT(*) as total
            FROM suppliers
            WHERE shop_id = UUID_TO_BIN(?)
            AND created_at BETWEEN ? AND ?
            GROUP BY DATE(created_at)
            ORDER BY date
          `;
          params.push(startDate, endDate);
          break;
          
        default: // sales
          query = `
            SELECT 
              DATE(created_at) as date,
              COALESCE(SUM(total_amount), 0) as total
            FROM bills
            WHERE shop_id = UUID_TO_BIN(?)
            AND created_at BETWEEN ? AND ?
            GROUP BY DATE(created_at)
            ORDER BY date
          `;
          params.push(startDate, endDate);
      }
    } else {
      // Default to last N days
      switch(type) {
        case 'expenses':
          query = `
            SELECT 
              DATE(expense_date) as date,
              COALESCE(SUM(amount), 0) as total
            FROM expenses
            WHERE shop_id = UUID_TO_BIN(?)
            AND expense_date >= CURDATE() - INTERVAL ? DAY
            GROUP BY DATE(expense_date)
            ORDER BY date
          `;
          params.push(days);
          break;
          
        case 'users':
          query = `
            SELECT 
              DATE(created_at) as date,
              COUNT(*) as total
            FROM users
            WHERE shop_id = UUID_TO_BIN(?)
            AND created_at >= CURDATE() - INTERVAL ? DAY
            GROUP BY DATE(created_at)
            ORDER BY date
          `;
          params.push(days);
          break;
          
        case 'products':
          query = `
            SELECT 
              DATE(created_at) as date,
              COUNT(*) as total
            FROM products
            WHERE shop_id = UUID_TO_BIN(?)
            AND created_at >= CURDATE() - INTERVAL ? DAY
            GROUP BY DATE(created_at)
            ORDER BY date
          `;
          params.push(days);
          break;
          
        case 'suppliers':
          query = `
            SELECT 
              DATE(created_at) as date,
              COUNT(*) as total
            FROM suppliers
            WHERE shop_id = UUID_TO_BIN(?)
            AND created_at >= CURDATE() - INTERVAL ? DAY
            GROUP BY DATE(created_at)
            ORDER BY date
          `;
          params.push(days);
          break;
          
        default: // sales
          query = `
            SELECT 
              DATE(created_at) as date,
              COALESCE(SUM(total_amount), 0) as total
            FROM bills
            WHERE shop_id = UUID_TO_BIN(?)
            AND created_at >= CURDATE() - INTERVAL ? DAY
            GROUP BY DATE(created_at)
            ORDER BY date
          `;
          params.push(days);
      }
    }

    const [rows] = await pool.execute(query, params);
    
    // Format dates to show properly
    const formattedRows = rows.map(row => ({
      date: new Date(row.date).toISOString().split('T')[0],
      total: parseFloat(row.total)
    }));

    res.json(formattedRows);
  } catch (err) {
    console.error('Error fetching graph data:', err);
    res.status(500).json({ error: 'Graph failed', details: err.message });
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
      `SELECT COUNT(*) as count 
       FROM inventory i
       JOIN products p ON p.id = i.product_id
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
   RECENT ACTIVITY (FIXED - DYNAMIC)
================================ */
exports.getActivity = async (req, res) => {
  try {
    const shopId = req.session.shopId || null;
    
    // Get recent activities from different tables
    const activities = [];
    
    // Get recent bills (sales)
    const [recentBills] = await pool.execute(
      `SELECT 
        'sale' as type,
        CONCAT('New sale #', bill_number, ' - ', customer_name, ' for ', FORMAT(total_amount, 0)) as description,
        created_at as timestamp
      FROM bills
      WHERE shop_id = UUID_TO_BIN(?)
      ORDER BY created_at DESC
      LIMIT 5`,
      [shopId]
    );
    
    // Get recent products added
    const [recentProducts] = await pool.execute(
      `SELECT 
        'product' as type,
        CONCAT('New product added: ', name) as description,
        created_at as timestamp
      FROM products
      WHERE shop_id = UUID_TO_BIN(?)
      ORDER BY created_at DESC
      LIMIT 3`,
      [shopId]
    );
    
    // Get recent users added
    const [recentUsers] = await pool.execute(
      `SELECT 
        'user' as type,
        CONCAT('New employee added: ', name) as description,
        created_at as timestamp
      FROM users
      WHERE shop_id = UUID_TO_BIN(?)
      ORDER BY created_at DESC
      LIMIT 3`,
      [shopId]
    );
    
    // Get recent stock updates
    const [recentStock] = await pool.execute(
      `SELECT 
        'inventory' as type,
        CONCAT('Stock updated for product: ', p.name, ' - Quantity: ', si.quantity) as description,
        si.created_at as timestamp
      FROM stock_in si
      JOIN products p ON p.id = si.product_id
      WHERE si.shop_id = UUID_TO_BIN(?)
      ORDER BY si.created_at DESC
      LIMIT 3`,
      [shopId]
    );
    
    // Combine all activities
    activities.push(...recentBills, ...recentProducts, ...recentUsers, ...recentStock);
    
    // Sort by timestamp (newest first)
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Take top 10
    const topActivities = activities.slice(0, 10);
    
    res.json(topActivities);
  } catch (err) {
    console.error('Error fetching activities:', err);
    // Return mock data as fallback
    res.json([
      { type: 'sale', description: 'Recent sales activity', timestamp: new Date() },
      { type: 'product', description: 'Products added recently', timestamp: new Date(Date.now() - 3600000) }
    ]);
  }
};

// Reorder product functionality
exports.reorderProduct = async (req, res) => {
  try {
    const { productId, quantity } = req.body;
    const shopId = req.session.shopId;
    const userId = req.session.userId;

    if (!productId) {
      return res.status(400).json({ error: 'Product ID required' });
    }

    // Get product details
    const [products] = await pool.execute(
      `SELECT p.name, p.sku, i.current_quantity, i.min_stock_level
       FROM products p
       LEFT JOIN inventory i ON p.id = i.product_id
       WHERE p.id = UUID_TO_BIN(?) AND p.shop_id = UUID_TO_BIN(?)`,
      [productId, shopId]
    );

    if (products.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = products[0];
    const reorderQuantity = quantity || (product.min_stock_level * 2) || 50;

    // Create a purchase order or stock in entry
    const stockInId = require('uuid').v4();
    await pool.execute(
      `INSERT INTO stock_in (id, shop_id, product_id, quantity, buying_price, selling_price, notes, received_by, created_at)
       VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, 
       (SELECT last_buying_price FROM inventory WHERE product_id = UUID_TO_BIN(?)),
       (SELECT selling_price FROM inventory WHERE product_id = UUID_TO_BIN(?)),
       'Auto reorder due to low stock', UUID_TO_BIN(?), NOW())`,
      [stockInId, shopId, productId, reorderQuantity, productId, productId, userId]
    );

    // Log the activity
    await pool.execute(
      `INSERT INTO admin_actions (id, admin_id, shop_id, action_type, details, created_at)
       VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), 'reorder', 
       JSON_OBJECT('action', 'Product reordered', 'product', ?, 'quantity', ?), NOW())`,
      [userId, shopId, product.name, reorderQuantity]
    );

    res.json({ 
      success: true, 
      message: `Reorder request submitted for ${product.name}. Quantity: ${reorderQuantity}` 
    });
  } catch (err) {
    console.error('Error processing reorder:', err);
    res.status(500).json({ error: 'Failed to process reorder' });
  }
};