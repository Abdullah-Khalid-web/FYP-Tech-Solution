const { pool } = require("../db");
const { format } = require("date-fns");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

class CashDepositController {
  // Get cash deposits with filters
    async getCashDeposits(req, res) {
        try {
            const shopId = req.session.shopId;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const offset = (page - 1) * limit;

            // Get filters
            const filters = {
                date_from: req.query.date_from || null,
                date_to: req.query.date_to || null,
                user_id: req.query.user_id || "all",
                status: req.query.status || "all",
                shift: req.query.shift || "all",
            };

            // Build WHERE clause
            let whereConditions = ["c.shop_id = UUID_TO_BIN(?)"];
            let params = [shopId];

            if (filters.date_from) {
                whereConditions.push("DATE(c.submission_date) >= ?");
                params.push(filters.date_from);
            }
            if (filters.date_to) {
                whereConditions.push("DATE(c.submission_date) <= ?");
                params.push(filters.date_to);
            }
            if (filters.user_id && filters.user_id !== "all") {
                whereConditions.push("c.user_id = UUID_TO_BIN(?)");
                params.push(filters.user_id);
            }
            if (filters.status && filters.status !== "all") {
                whereConditions.push("c.status = ?");
                params.push(filters.status);
            }
            if (filters.shift && filters.shift !== "all") {
                whereConditions.push("c.shift = ?");
                params.push(filters.shift);
            }

            const whereClause = whereConditions.join(" AND ");

            // Get total count
            const [countResult] = await pool.execute(
                `SELECT COUNT(*) as total FROM user_cash_submission c WHERE ${whereClause}`,
                params,
            );
            const totalRecords = countResult[0].total;
            const totalPages = Math.ceil(totalRecords / limit);

            // Get deposits with user info
            const [deposits] = await pool.execute(
                `SELECT 
                    BIN_TO_UUID(c.id) as id,
                    DATE(c.submission_date) as submission_date,
                    c.total_collected,
                    c.submitted_amount,
                    c.difference,
                    c.notes,
                    c.status,
                    c.shift,
                    c.payment_method,
                    c.reference_number,
                    c.created_at,
                    BIN_TO_UUID(c.user_id) as user_id,
                    u.name as user_name,
                    BIN_TO_UUID(c.verified_by) as verified_by_id,
                    vu.name as verified_by_name,
                    c.verified_at,
                    c.rejection_reason
                FROM user_cash_submission c
                LEFT JOIN users u ON c.user_id = u.id
                LEFT JOIN users vu ON c.verified_by = vu.id
                WHERE ${whereClause}
                ORDER BY c.submission_date DESC, c.created_at DESC
                LIMIT ? OFFSET ?`,
                [...params, limit, offset],
            );

            // Get users list for filter
            const [users] = await pool.execute(
                `SELECT BIN_TO_UUID(id) as id, name 
                FROM users 
                WHERE shop_id = UUID_TO_BIN(?) AND status = 'active'
                ORDER BY name`,
                [shopId],
            );

            // Get today's sales for reference
            const [[todaySales]] = await pool.execute(
                `SELECT COALESCE(SUM(total_amount), 0) as total
                FROM bills
                WHERE shop_id = UUID_TO_BIN(?) 
                AND DATE(created_at) = CURDATE()
                AND payment_method IN ('cash', 'Cash')`,
                [shopId],
            );

            // Make sure to convert to number
            const todayCollected = parseFloat(todaySales.total) || 0;

            // Get summary statistics - MOVED BEFORE render
            const [summary] = await pool.execute(
                `SELECT 
                    COUNT(*) as total_deposits,
                    COALESCE(SUM(total_collected), 0) as total_collected,
                    COALESCE(SUM(submitted_amount), 0) as total_submitted,
                    COALESCE(SUM(difference), 0) as total_difference,
                    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
                    COUNT(CASE WHEN status = 'verified' THEN 1 END) as verified_count
                FROM user_cash_submission
                WHERE shop_id = UUID_TO_BIN(?) 
                AND MONTH(submission_date) = MONTH(CURRENT_DATE())
                AND YEAR(submission_date) = YEAR(CURRENT_DATE())`,
                [shopId],
            );

            // Get active cash register for current user - MOVED BEFORE render
            const [activeRegister] = await pool.execute(
                `SELECT 
                    BIN_TO_UUID(id) as id,
                    shift_start,
                    opening_balance
                FROM cash_register
                WHERE shop_id = UUID_TO_BIN(?)
                AND user_id = UUID_TO_BIN(?)
                AND status = 'open'`,
                [shopId, req.session.userId],
            );

            // Get recent register closures - MOVED BEFORE render
            const [recentRegisters] = await pool.execute(
                `SELECT 
                    BIN_TO_UUID(id) as id,
                    shift_start,
                    shift_end,
                    opening_balance,
                    closing_balance,
                    expected_balance,
                    difference,
                    status
                FROM cash_register
                WHERE shop_id = UUID_TO_BIN(?)
                AND user_id = UUID_TO_BIN(?)
                ORDER BY shift_start DESC
                LIMIT 5`,
                [shopId, req.session.userId],
            );

            // Get shop details - MOVED BEFORE render
            const [[shop]] = await pool.execute(
                `SELECT name, currency, primary_color 
                FROM shops 
                WHERE id = UUID_TO_BIN(?)`,
                [shopId],
            );

            // Process summary values
            const processedSummary = {
                total_collected: parseFloat(summary[0]?.total_collected) || 0,
                total_submitted: parseFloat(summary[0]?.total_submitted) || 0,
                total_difference: parseFloat(summary[0]?.total_difference) || 0,
                pending_count: parseInt(summary[0]?.pending_count) || 0,
                verified_count: parseInt(summary[0]?.verified_count) || 0,
                total_deposits: parseInt(summary[0]?.total_deposits) || 0
            };

            // Now render with ALL variables defined
            res.render("cash-deposits/index", {
                title: "Cash Deposit Management",
                deposits: deposits,
                users: users,
                filters: filters,
                todayCollected: todayCollected,
                summary: processedSummary,
                activeRegister: activeRegister[0] || null,
                recentRegisters: recentRegisters,
                shop: shop || { currency: "PKR", name: "My Shop" },
                currentPage: page,
                totalPages: totalPages,
                limit: limit,
                totalRecords: totalRecords,
                currentUser: req.session.userId,
                hasVerifyPermission: req.userPermissions?.includes("cash.verify") || false,
                hasDeletePermission: req.userPermissions?.includes("cash.delete") || false,
                success: req.query.success,
                error: req.query.error,
            });
            
        } catch (err) {
            console.error("Cash deposit page error:", err);
            res.status(500).render("error", {
                title: "Error",
                message: "Failed to load cash deposits: " + err.message,
            });
        }
    }

  // Create new cash deposit
  async createCashDeposit(req, res) {
    try {
      const {
        submission_date,
        total_collected,
        submitted_amount,
        notes,
        shift,
        payment_method,
        reference_number,
      } = req.body;

      if (!submission_date || !total_collected || !submitted_amount) {
        return res.status(400).json({
          success: false,
          message: "Date and amounts are required",
        });
      }

      const difference =
        parseFloat(total_collected) - parseFloat(submitted_amount);

      await pool.execute(
        `INSERT INTO user_cash_submission
                (id, shop_id, user_id, submission_date, total_collected, 
                 submitted_amount, difference, notes, shift, payment_method, reference_number)
                VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.session.shopId,
          req.session.userId,
          submission_date,
          parseFloat(total_collected),
          parseFloat(submitted_amount),
          difference,
          notes || null,
          shift || "morning",
          payment_method || "cash",
          reference_number || null,
        ],
      );

      if (req.xhr || req.headers.accept?.includes("json")) {
        return res.json({
          success: true,
          message: "Cash deposit saved successfully",
        });
      }

      res.redirect("/cash-deposits?success=Cash deposit saved successfully");
    } catch (err) {
      console.error("Cash deposit save error:", err);
      if (req.xhr || req.headers.accept?.includes("json")) {
        return res.status(500).json({
          success: false,
          message: "Failed to save cash deposit",
        });
      }
      res.redirect("/cash-deposits?error=Failed to save cash deposit");
    }
  }

  // Verify cash deposit
  async verifyCashDeposit(req, res) {
    try {
      const { id } = req.params;
      const { status, rejection_reason } = req.body;

      await pool.execute(
        `UPDATE user_cash_submission 
                SET status = ?, 
                    verified_by = UUID_TO_BIN(?),
                    verified_at = NOW(),
                    rejection_reason = ?
                WHERE id = UUID_TO_BIN(?) 
                AND shop_id = UUID_TO_BIN(?)`,
        [
          status,
          req.session.userId,
          rejection_reason || null,
          id,
          req.session.shopId,
        ],
      );

      res.json({ success: true, message: "Deposit verified successfully" });
    } catch (err) {
      console.error("Verify deposit error:", err);
      res
        .status(500)
        .json({ success: false, message: "Failed to verify deposit" });
    }
  }

  // Delete cash deposit
  async deleteCashDeposit(req, res) {
    try {
      const { id } = req.params;

      const [result] = await pool.execute(
        `DELETE FROM user_cash_submission 
                WHERE id = UUID_TO_BIN(?) 
                AND shop_id = UUID_TO_BIN(?)
                AND status = 'pending'`,
        [id, req.session.shopId],
      );

      if (result.affectedRows === 0) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete verified deposits",
        });
      }

      res.json({ success: true, message: "Deposit deleted successfully" });
    } catch (err) {
      console.error("Delete deposit error:", err);
      res
        .status(500)
        .json({ success: false, message: "Failed to delete deposit" });
    }
  }

  // Open cash register
  async openCashRegister(req, res) {
    try {
      const { opening_balance, notes } = req.body;

      if (!opening_balance) {
        return res.status(400).json({
          success: false,
          message: "Opening balance is required",
        });
      }

      // Check if already have open register
      const [existing] = await pool.execute(
        `SELECT id FROM cash_register 
                WHERE shop_id = UUID_TO_BIN(?) 
                AND user_id = UUID_TO_BIN(?) 
                AND status = 'open'`,
        [req.session.shopId, req.session.userId],
      );

      if (existing.length > 0) {
        return res.status(400).json({
          success: false,
          message: "You already have an open cash register",
        });
      }

      await pool.execute(
        `INSERT INTO cash_register
                (id, shop_id, user_id, shift_start, opening_balance, notes)
                VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), NOW(), ?, ?)`,
        [
          req.session.shopId,
          req.session.userId,
          parseFloat(opening_balance),
          notes || null,
        ],
      );

      res.json({ success: true, message: "Cash register opened successfully" });
    } catch (err) {
      console.error("Open register error:", err);
      res
        .status(500)
        .json({ success: false, message: "Failed to open cash register" });
    }
  }

  // Close cash register
  async closeCashRegister(req, res) {
    try {
      const { closing_balance, notes } = req.body;

      if (!closing_balance) {
        return res.status(400).json({
          success: false,
          message: "Closing balance is required",
        });
      }

      // Get register and calculate expected balance
      const [register] = await pool.execute(
        `SELECT opening_balance, shift_start
                FROM cash_register
                WHERE shop_id = UUID_TO_BIN(?)
                AND user_id = UUID_TO_BIN(?)
                AND status = 'open'`,
        [req.session.shopId, req.session.userId],
      );

      if (register.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No open cash register found",
        });
      }

      // Calculate expected balance (opening + sales - deposits)
      const [sales] = await pool.execute(
        `SELECT COALESCE(SUM(total_amount), 0) as total_sales
                FROM bills
                WHERE shop_id = UUID_TO_BIN(?)
                AND created_by = UUID_TO_BIN(?)
                AND DATE(created_at) = CURDATE()
                AND payment_method = 'cash'`,
        [req.session.shopId, req.session.userId],
      );

      const [deposits] = await pool.execute(
        `SELECT COALESCE(SUM(submitted_amount), 0) as total_deposits
                FROM user_cash_submission
                WHERE shop_id = UUID_TO_BIN(?)
                AND user_id = UUID_TO_BIN(?)
                AND DATE(submission_date) = CURDATE()`,
        [req.session.shopId, req.session.userId],
      );

      const expectedBalance =
        register[0].opening_balance +
        parseFloat(sales[0].total_sales) -
        parseFloat(deposits[0].total_deposits);
      const difference = parseFloat(closing_balance) - expectedBalance;

      await pool.execute(
        `UPDATE cash_register
                SET shift_end = NOW(),
                    closing_balance = ?,
                    expected_balance = ?,
                    difference = ?,
                    status = 'closed',
                    notes = CONCAT(notes, ' ', ?)
                WHERE shop_id = UUID_TO_BIN(?)
                AND user_id = UUID_TO_BIN(?)
                AND status = 'open'`,
        [
          parseFloat(closing_balance),
          expectedBalance,
          difference,
          notes || "",
          req.session.shopId,
          req.session.userId,
        ],
      );

      res.json({
        success: true,
        message: "Cash register closed successfully",
        expected_balance: expectedBalance,
        difference: difference,
      });
    } catch (err) {
      console.error("Close register error:", err);
      res
        .status(500)
        .json({ success: false, message: "Failed to close cash register" });
    }
  }

  // Get cash register page
  async getCashRegister(req, res) {
    try {
      const shopId = req.session.shopId;

      const [activeRegister] = await pool.execute(
        `SELECT 
                    BIN_TO_UUID(id) as id,
                    shift_start,
                    opening_balance,
                    notes
                FROM cash_register
                WHERE shop_id = UUID_TO_BIN(?)
                AND user_id = UUID_TO_BIN(?)
                AND status = 'open'`,
        [shopId, req.session.userId],
      );

      // Get today's sales
      const [todaySales] = await pool.execute(
        `SELECT 
                    COALESCE(SUM(total_amount), 0) as total_sales,
                    COUNT(*) as bill_count
                FROM bills
                WHERE shop_id = UUID_TO_BIN(?)
                AND created_by = UUID_TO_BIN(?)
                AND DATE(created_at) = CURDATE()
                AND payment_method = 'cash'`,
        [shopId, req.session.userId],
      );

      // Get today's deposits
      const [todayDeposits] = await pool.execute(
        `SELECT 
                    COALESCE(SUM(submitted_amount), 0) as total_deposits,
                    COUNT(*) as deposit_count
                FROM user_cash_submission
                WHERE shop_id = UUID_TO_BIN(?)
                AND user_id = UUID_TO_BIN(?)
                AND DATE(submission_date) = CURDATE()`,
        [shopId, req.session.userId],
      );

      const [[shop]] = await pool.execute(
        `SELECT name, currency FROM shops WHERE id = UUID_TO_BIN(?)`,
        [shopId],
      );

      res.render("cash-deposits/register", {
        title: "Cash Register",
        activeRegister: activeRegister[0],
        todaySales: todaySales[0],
        todayDeposits: todayDeposits[0],
        shop: shop || { currency: "PKR" },
      });
    } catch (err) {
      console.error("Cash register page error:", err);
      res.status(500).render("error", {
        title: "Error",
        message: "Failed to load cash register",
      });
    }
  }

  // Get cash summary (for API)
  async getCashSummary(req, res) {
    try {
      const shopId = req.session.shopId;
      const period = req.query.period || "today";

      let dateCondition;
      switch (period) {
        case "today":
          dateCondition = "DATE(submission_date) = CURDATE()";
          break;
        case "week":
          dateCondition = "YEARWEEK(submission_date) = YEARWEEK(CURDATE())";
          break;
        case "month":
          dateCondition =
            "MONTH(submission_date) = MONTH(CURDATE()) AND YEAR(submission_date) = YEAR(CURDATE())";
          break;
        default:
          dateCondition = "DATE(submission_date) = CURDATE()";
      }

      const [summary] = await pool.execute(
        `SELECT 
                    COUNT(*) as total_deposits,
                    COALESCE(SUM(total_collected), 0) as total_collected,
                    COALESCE(SUM(submitted_amount), 0) as total_submitted,
                    COALESCE(SUM(difference), 0) as total_difference,
                    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                    COUNT(CASE WHEN status = 'verified' THEN 1 END) as verified,
                    COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected
                FROM user_cash_submission
                WHERE shop_id = UUID_TO_BIN(?)
                AND ${dateCondition}`,
        [shopId],
      );

      res.json({ success: true, data: summary[0] });
    } catch (err) {
      console.error("Cash summary error:", err);
      res
        .status(500)
        .json({ success: false, message: "Failed to get summary" });
    }
  }

  // Get cash reports
  async getCashReports(req, res) {
    try {
      const shopId = req.session.shopId;
      const { start_date, end_date, user_id } = req.query;

      let query = `
                SELECT 
                    DATE(c.submission_date) as date,
                    COUNT(*) as deposit_count,
                    COALESCE(SUM(c.total_collected), 0) as total_collected,
                    COALESCE(SUM(c.submitted_amount), 0) as total_submitted,
                    COALESCE(SUM(c.difference), 0) as total_difference,
                    GROUP_CONCAT(DISTINCT u.name) as users
                FROM user_cash_submission c
                LEFT JOIN users u ON c.user_id = u.id
                WHERE c.shop_id = UUID_TO_BIN(?)
            `;
      let params = [shopId];

      if (start_date && end_date) {
        query += ` AND DATE(c.submission_date) BETWEEN ? AND ?`;
        params.push(start_date, end_date);
      }

      if (user_id && user_id !== "all") {
        query += ` AND c.user_id = UUID_TO_BIN(?)`;
        params.push(user_id);
      }

      query += ` GROUP BY DATE(c.submission_date) ORDER BY date DESC LIMIT 30`;

      const [reports] = await pool.execute(query, params);

      // Get users for filter
      const [users] = await pool.execute(
        `SELECT BIN_TO_UUID(id) as id, name FROM users WHERE shop_id = UUID_TO_BIN(?) AND status = 'active'`,
        [shopId],
      );

      const [[shop]] = await pool.execute(
        `SELECT name, currency FROM shops WHERE id = UUID_TO_BIN(?)`,
        [shopId],
      );

      res.render("cash-deposits/reports", {
        title: "Cash Reports",
        reports,
        users,
        shop: shop || { currency: "PKR" },
        start_date: start_date || "",
        end_date: end_date || "",
        selected_user: user_id || "all",
      });
    } catch (err) {
      console.error("Cash reports error:", err);
      res.status(500).render("error", {
        title: "Error",
        message: "Failed to load cash reports",
      });
    }
  }

  // Export cash deposits to Excel
  async exportCashDeposits(req, res) {
    try {
      const shopId = req.session.shopId;
      const { start_date, end_date } = req.query;

      let query = `
                SELECT 
                    DATE(c.submission_date) as 'Date',
                    u.name as 'User',
                    c.total_collected as 'Total Collected',
                    c.submitted_amount as 'Submitted Amount',
                    c.difference as 'Difference',
                    c.status as 'Status',
                    c.shift as 'Shift',
                    c.payment_method as 'Payment Method',
                    c.reference_number as 'Reference',
                    c.notes as 'Notes',
                    c.created_at as 'Created At'
                FROM user_cash_submission c
                LEFT JOIN users u ON c.user_id = u.id
                WHERE c.shop_id = UUID_TO_BIN(?)
            `;
      let params = [shopId];

      if (start_date && end_date) {
        query += ` AND DATE(c.submission_date) BETWEEN ? AND ?`;
        params.push(start_date, end_date);
      }

      query += ` ORDER BY c.submission_date DESC`;

      const [deposits] = await pool.execute(query, params);

      const [[shop]] = await pool.execute(
        `SELECT name FROM shops WHERE id = UUID_TO_BIN(?)`,
        [shopId],
      );

      // Create Excel workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Cash Deposits");

      // Add headers
      const headers = Object.keys(deposits[0] || {});
      worksheet.addRow(headers);

      // Style headers
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF4E73DF" },
      };
      headerRow.font = { color: { argb: "FFFFFFFF" }, bold: true };

      // Add data
      deposits.forEach((deposit) => {
        const row = headers.map((header) => deposit[header]);
        worksheet.addRow(row);
      });

      // Auto-size columns
      worksheet.columns.forEach((column) => {
        let maxLength = 10;
        column.eachCell({ includeEmpty: true }, (cell) => {
          const cellLength = cell.value ? String(cell.value).length : 10;
          maxLength = Math.max(maxLength, cellLength);
        });
        column.width = Math.min(maxLength + 2, 30);
      });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=cash_deposits_${format(new Date(), "yyyy-MM-dd")}.xlsx`,
      );

      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("Export error:", err);
      res.status(500).json({ success: false, message: "Export failed" });
    }
  }
}

module.exports = new CashDepositController();
