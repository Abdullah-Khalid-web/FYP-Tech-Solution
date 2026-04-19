const { pool } = require('../db');
<<<<<<< HEAD
=======
const RoleHelper = require('../helpers/roleHelper');
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96

const MIN_STOCK = 5;

/* ===============================
   RENDER DASHBOARD PAGE
================================ */
<<<<<<< HEAD
exports.renderDashboard = async (req, res) => {
  try {
    const shopId = req.session.shopId;
    const user = req.session.user;

    const [[shop]] = await pool.execute(
      `SELECT BIN_TO_UUID(id) id, name, address 
=======
// controllers/dashboardController.js
// In dashboardController.js
exports.renderDashboard = async (req, res) => {
  try {
    const shopId = req.session.shopId;
    const roleHelper = new RoleHelper(req.session);

    // Pre-fetch stats data
    let stats = {
      totalProducts: 0,
      todaySales: 0,
      totalEmployees: 0,
      lowStockItems: 0
    };

    try {
      // Get products count
      const [[products]] = await pool.execute(
        `SELECT COUNT(*) count FROM products WHERE shop_id = UUID_TO_BIN(?)`,
        [shopId]
      );
      stats.totalProducts = products.count;

      // Get sales if allowed
      if (roleHelper.canAccessSales()) {
        const [[sales]] = await pool.execute(
          `SELECT IFNULL(SUM(total_amount),0) total
           FROM bills
           WHERE shop_id = UUID_TO_BIN(?)
           AND DATE(created_at) = CURDATE()`,
          [shopId]
        );
        stats.todaySales = sales.total;
      }

      // Get employees if allowed
      if (roleHelper.canViewEmployees()) {
        const [[employees]] = await pool.execute(
          `SELECT COUNT(*) count FROM users WHERE shop_id = UUID_TO_BIN(?)`,
          [shopId]
        );
        stats.totalEmployees = employees.count;
      }

      // Get low stock if allowed
      if (roleHelper.canAccessInventory()) {
        const [[lowStock]] = await pool.execute(
          `SELECT COUNT(*) count
           FROM inventory
           WHERE shop_id = UUID_TO_BIN(?)
           AND current_quantity < min_stock_level`,
          [shopId]
        );
        stats.lowStockItems = lowStock.count;
      }
    } catch (dbErr) {
      console.error('Error pre-fetching stats:', dbErr);
    }

    const [[shop]] = await pool.execute(
      `SELECT BIN_TO_UUID(id) id, name, address, logo, currency 
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96
       FROM shops WHERE id = UUID_TO_BIN(?)`,
      [shopId]
    );

<<<<<<< HEAD
    res.render('dashboard', { user, shop });
  } catch (err) {
    console.error(err);
=======
    const user = {
      id: req.session.userId,
      username: req.session.username,
      email: req.session.userEmail,
      roleName: req.session.roleName,
      roleId: req.session.roleId,
      shopId: req.session.shopId
    };

    // Pass pre-fetched stats to the view
    res.render('dashboard', { 
      user,
      shop,
      roleHelper,
      initialStats: stats,  // Add this
      MIN_STOCK: 5
    });
  } catch (err) {
    console.error('Dashboard render error:', err);
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96
    res.status(500).send('Dashboard load failed');
  }
};

/* ===============================
<<<<<<< HEAD
   DASHBOARD STATS
=======
   DASHBOARD STATS (Role-based)
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96
================================ */
exports.getStats = async (req, res) => {
  try {
    const shopId = req.session.shopId;
<<<<<<< HEAD

=======
    const roleHelper = new RoleHelper(req.session);
    const stats = {};

    // Everyone can see products count
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96
    const [[products]] = await pool.execute(
      `SELECT COUNT(*) count FROM products 
       WHERE shop_id = UUID_TO_BIN(?)`,
      [shopId]
    );
<<<<<<< HEAD

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
=======
    stats.totalProducts = products.count;

    // Only managers and above can see employee count
    if (roleHelper.canManageEmployees()) {
      const [[employees]] = await pool.execute(
        `SELECT COUNT(*) count FROM users 
         WHERE shop_id = UUID_TO_BIN(?)`,
        [shopId]
      );
      stats.totalEmployees = employees.count;
    } else {
      stats.totalEmployees = 'Restricted';
    }

    // Sales stats for cashiers, managers, owners
    if (roleHelper.canAccessSales()) {
      const [[sales]] = await pool.execute(
        `SELECT IFNULL(SUM(total_amount),0) total
         FROM bills
         WHERE shop_id = UUID_TO_BIN(?)
         AND DATE(created_at) = CURDATE()`,
        [shopId]
      );
      stats.todaySales = sales.total;
    } else {
      stats.todaySales = 'Restricted';
    }

    // Inventory stats for inventory managers
    if (roleHelper.canAccessInventory()) {
      const [[lowStock]] = await pool.execute(
        `SELECT COUNT(*) count
         FROM inventory
         WHERE shop_id = UUID_TO_BIN(?)
         AND current_quantity < ?`,
        [shopId, MIN_STOCK]
      );
      stats.lowStockItems = lowStock.count;
    } else {
      stats.lowStockItems = 'Restricted';
    }

    res.json(stats);
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Stats failed' });
  }
};

/* ===============================
<<<<<<< HEAD
   RECENT SALES
=======
   RECENT SALES (Role-based)
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96
================================ */
exports.getRecentSales = async (req, res) => {
  try {
    const shopId = req.session.shopId;
<<<<<<< HEAD
=======
    const roleHelper = new RoleHelper(req.session);

    // Only users with sales access can see recent sales
    if (!roleHelper.canAccessSales()) {
      return res.json([]);
    }
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96

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
<<<<<<< HEAD
   LOW STOCK
=======
   LOW STOCK (Role-based)
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96
================================ */
exports.getLowStock = async (req, res) => {
  try {
    const shopId = req.session.shopId;
<<<<<<< HEAD
=======
    const roleHelper = new RoleHelper(req.session);

    // Only inventory managers and above can see low stock
    if (!roleHelper.canAccessInventory()) {
      return res.json([]);
    }
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96

    const [rows] = await pool.execute(
      `SELECT 
         BIN_TO_UUID(p.id) id,
         p.name,
<<<<<<< HEAD
         i.current_quantity
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       WHERE i.shop_id = UUID_TO_BIN(?)
       AND i.current_quantity < ?
       ORDER BY i.current_quantity ASC
       LIMIT 5`,
      [shopId, MIN_STOCK]
=======
         i.current_quantity,
         i.min_stock_level
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       WHERE i.shop_id = UUID_TO_BIN(?)
       AND i.current_quantity < i.min_stock_level
       ORDER BY i.current_quantity ASC
       LIMIT 10`,
      [shopId]
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Low stock failed' });
  }
};

/* ===============================
<<<<<<< HEAD
=======
   RECENT ACTIVITY
================================ */
exports.getRecentActivity = async (req, res) => {
  try {
    const shopId = req.session.shopId;
    const roleHelper = new RoleHelper(req.session);
    
    let activities = [];

    // Recent sales (visible to sales roles)
    if (roleHelper.canAccessSales()) {
      const [sales] = await pool.execute(
        `SELECT 
           'sale' as type,
           bill_number as title,
           CONCAT('Sale of ₹', total_amount) as description,
           created_at as timestamp
         FROM bills
         WHERE shop_id = UUID_TO_BIN(?)
         ORDER BY created_at DESC
         LIMIT 3`,
        [shopId]
      );
      activities = [...activities, ...sales];
    }

    // Recent inventory movements (visible to inventory roles)
    if (roleHelper.canAccessInventory()) {
      const [inventory] = await pool.execute(
        `SELECT 
           'inventory' as type,
           'Stock Update' as title,
           CONCAT(quantity, ' units of ', p.name) as description,
           si.created_at as timestamp
         FROM stock_in si
         JOIN products p ON si.product_id = p.id
         WHERE si.shop_id = UUID_TO_BIN(?)
         ORDER BY si.created_at DESC
         LIMIT 3`,
        [shopId]
      );
      activities = [...activities, ...inventory];
    }

    // Recent employee actions (visible to HR/Manager roles)
    if (roleHelper.canManageEmployees()) {
      const [employees] = await pool.execute(
        `SELECT 
           'employee' as type,
           'Employee Update' as title,
           CONCAT(u.name, ' was added/updated') as description,
           u.created_at as timestamp
         FROM users u
         WHERE u.shop_id = UUID_TO_BIN(?)
         ORDER BY u.created_at DESC
         LIMIT 3`,
        [shopId]
      );
      activities = [...activities, ...employees];
    }

    // Sort all activities by timestamp
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Limit to 10 activities
    activities = activities.slice(0, 10);

    res.json(activities);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Activity failed' });
  }
};

/* ===============================
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96
   SALES GRAPH (LAST 7 DAYS)
================================ */
exports.getSalesGraph = async (req, res) => {
  try {
    const shopId = req.session.shopId;
<<<<<<< HEAD
=======
    const roleHelper = new RoleHelper(req.session);

    // Only users with sales access can see graph
    if (!roleHelper.canAccessSales()) {
      return res.json([]);
    }
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96

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
<<<<<<< HEAD
=======

/* ===============================
   DAILY SUMMARY
================================ */
exports.getDailySummary = async (req, res) => {
  try {
    const shopId = req.session.shopId;
    const roleHelper = new RoleHelper(req.session);
    
    const summary = {};

    // Sales summary
    if (roleHelper.canAccessSales()) {
      const [[sales]] = await pool.execute(
        `SELECT 
           COUNT(*) as transactions,
           IFNULL(SUM(total_amount),0) as total
         FROM bills
         WHERE shop_id = UUID_TO_BIN(?)
         AND DATE(created_at) = CURDATE()`,
        [shopId]
      );
      summary.todaySales = sales.total;
      summary.totalTransactions = sales.transactions;

      // Top products
      const [topProducts] = await pool.execute(
        `SELECT 
           p.name,
           SUM(bi.quantity) as quantity
         FROM bill_items bi
         JOIN products p ON bi.product_id = p.id
         WHERE bi.shop_id = UUID_TO_BIN(?)
         AND DATE(bi.created_at) = CURDATE()
         GROUP BY p.id
         ORDER BY quantity DESC
         LIMIT 5`,
        [shopId]
      );
      summary.topProducts = topProducts;
    }

    // Inventory summary
    if (roleHelper.canAccessInventory()) {
      const [[lowStock]] = await pool.execute(
        `SELECT COUNT(*) as count
         FROM inventory
         WHERE shop_id = UUID_TO_BIN(?)
         AND current_quantity < min_stock_level`,
        [shopId]
      );
      summary.lowStockItems = lowStock.count;
    }

    res.json(summary);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Summary failed' });
  }
};
>>>>>>> 8ebba1f72e0d8c7dec787338560c73865fc45c96
