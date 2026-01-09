const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Middleware to get shop info
const getShopInfo = async (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    try {
        // Get shop_id from user
        const [users] = await pool.execute(
            'SELECT BIN_TO_UUID(shop_id) as shop_id FROM users WHERE id = UUID_TO_BIN(?)',
            [req.session.userId]
        );

        if (users.length === 0 || !users[0].shop_id) {
            return res.status(403).json({ success: false, message: 'Shop not found' });
        }

        req.shopId = users[0].shop_id;

        // Get shop details
        const [shops] = await pool.execute(
            'SELECT name, logo, currency, primary_color, secondary_color FROM shops WHERE id = UUID_TO_BIN(?)',
            [req.shopId]
        );

        if (shops.length > 0) {
            req.shop = {
                id: req.shopId,
                name: shops[0].name || 'My Shop',
                logo: shops[0].logo ? `/uploads/${shops[0].logo}` : '/images/default-logo.png',
                currency: shops[0].currency || 'PKR',
                primary_color: shops[0].primary_color || '#007bff',
                secondary_color: shops[0].secondary_color || '#6c757d'
            };
        } else {
            req.shop = {
                id: req.shopId,
                name: 'My Shop',
                logo: '/images/default-logo.png',
                currency: 'PKR',
                primary_color: '#007bff',
                secondary_color: '#6c757d'
            };
        }
        next();
    } catch (err) {
        console.error('Error in getShopInfo middleware:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Common expense categories
const EXPENSE_CATEGORIES = [
    'Electricity',
    'Water',
    'Gas',
    'Internet',
    'Rent',
    'Salaries',
    'Tea & Refreshments',
    'Office Supplies',
    'Maintenance',
    'Transportation',
    'Marketing',
    'Taxes',
    'Insurance',
    'Other'
];

// GET expenses page
router.get('/', getShopInfo, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        
        const { category, date_from, date_to, payment_method } = req.query;

        let whereClause = 'WHERE e.shop_id = UUID_TO_BIN(?)';
        const queryParams = [req.shopId];

        if (category && category !== 'all') {
            whereClause += ' AND e.category = ?';
            queryParams.push(category);
        }

        if (date_from) {
            whereClause += ' AND e.expense_date >= ?';
            queryParams.push(date_from);
        }

        if (date_to) {
            whereClause += ' AND e.expense_date <= ?';
            queryParams.push(date_to);
        }

        if (payment_method && payment_method !== 'all') {
            whereClause += ' AND e.payment_method = ?';
            queryParams.push(payment_method);
        }

        // Get expenses with user information
        const [expenses] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(e.id) as id,
                e.category,
                e.description,
                e.amount,
                e.expense_date,
                e.payment_method,
                e.receipt_number,
                e.created_at,
                BIN_TO_UUID(u.id) as created_by_id,
                u.name as created_by_name
             FROM expenses e
             LEFT JOIN users u ON e.created_by = u.id
             ${whereClause}
             ORDER BY e.expense_date DESC, e.created_at DESC
             LIMIT ? OFFSET ?`,
            [...queryParams, limit, offset]
        );

        // Get total count for pagination
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM expenses e ${whereClause}`,
            queryParams
        );
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Get summary statistics
        const [todaySummary] = await pool.execute(
            `SELECT COALESCE(SUM(amount), 0) as total 
             FROM expenses 
             WHERE shop_id = UUID_TO_BIN(?) AND expense_date = CURDATE()`,
            [req.shopId]
        );

        const [monthSummary] = await pool.execute(
            `SELECT COALESCE(SUM(amount), 0) as total 
             FROM expenses 
             WHERE shop_id = UUID_TO_BIN(?) 
             AND YEAR(expense_date) = YEAR(CURDATE()) 
             AND MONTH(expense_date) = MONTH(CURDATE())`,
            [req.shopId]
        );

        res.render('expenses/index', {
            title: 'Shop Expenses',
            expenses,
            categories: EXPENSE_CATEGORIES,
            currentPage: page,
            totalPages,
            totalExpenses: total,
            todayTotal: todaySummary[0].total,
            monthTotal: monthSummary[0].total,
            shop: req.shop || {},
            filters: { category, date_from, date_to, payment_method }
        });
    } catch (err) {
        console.error('Error fetching expenses:', err);
        res.status(500).render('error', {
            title: 'Error',
            message: 'An error occurred while fetching expenses'
        });
    }
});

// POST create new expense
router.post('/', getShopInfo, async (req, res) => {
    try {
        const {
            category,
            description,
            amount,
            expense_date,
            payment_method,
            receipt_number
        } = req.body;

        // Validation
        if (!category || !description || !amount || !expense_date) {
            return res.status(400).json({
                success: false,
                message: 'Category, description, amount, and date are required'
            });
        }

        if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Amount must be a positive number'
            });
        }

        await pool.execute(
            `INSERT INTO expenses 
             (id, shop_id, category, description, amount, expense_date, payment_method, receipt_number, created_by)
             VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, UUID_TO_BIN(?))`,
            [
                req.shopId,
                category,
                description,
                parseFloat(amount),
                expense_date,
                payment_method || 'cash',
                receipt_number || null,
                req.session.userId
            ]
        );

        res.json({
            success: true,
            message: 'Expense added successfully'
        });
    } catch (err) {
        console.error('Error creating expense:', err);
        res.status(500).json({
            success: false,
            message: 'Error creating expense'
        });
    }
});

// GET expense statistics
router.get('/statistics', getShopInfo, async (req, res) => {
    try {
        const { period = 'monthly' } = req.query;

        let dateFormat, groupBy;
        switch (period) {
            case 'daily':
                dateFormat = '%Y-%m-%d';
                groupBy = 'expense_date';
                break;
            case 'weekly':
                dateFormat = '%Y-%u';
                groupBy = 'YEARWEEK(expense_date)';
                break;
            case 'monthly':
            default:
                dateFormat = '%Y-%m';
                groupBy = 'DATE_FORMAT(expense_date, "%Y-%m")';
                break;
            case 'yearly':
                dateFormat = '%Y';
                groupBy = 'YEAR(expense_date)';
                break;
        }

        // Category-wise summary
        const [categorySummary] = await pool.execute(
            `SELECT 
                category,
                COUNT(*) as count,
                SUM(amount) as total_amount
             FROM expenses
             WHERE shop_id = UUID_TO_BIN(?) AND expense_date >= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)
             GROUP BY category
             ORDER BY total_amount DESC`,
            [req.shopId]
        );

        // Time-based summary
        const [timeSummary] = await pool.execute(
            `SELECT 
                DATE_FORMAT(expense_date, '${dateFormat}') as period,
                COUNT(*) as count,
                SUM(amount) as total_amount
             FROM expenses
             WHERE shop_id = UUID_TO_BIN(?) AND expense_date >= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)
             GROUP BY ${groupBy}
             ORDER BY period DESC
             LIMIT 12`,
            [req.shopId]
        );

        // User-wise summary
        const [userSummary] = await pool.execute(
            `SELECT 
                u.name,
                COUNT(e.id) as expense_count,
                SUM(e.amount) as total_amount
             FROM expenses e
             LEFT JOIN users u ON e.created_by = u.id
             WHERE e.shop_id = UUID_TO_BIN(?) AND e.expense_date >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
             GROUP BY e.created_by, u.name
             ORDER BY total_amount DESC`,
            [req.shopId]
        );

        res.json({
            success: true,
            data: {
                categorySummary,
                timeSummary,
                userSummary,
                period
            }
        });
    } catch (err) {
        console.error('Error fetching expense statistics:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching expense statistics'
        });
    }
});

// DELETE expense
router.delete('/:id', getShopInfo, async (req, res) => {
    try {
        const expenseId = req.params.id;

        // Verify expense exists and belongs to this shop
        const [expenses] = await pool.execute(
            `SELECT id FROM expenses WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [expenseId, req.shopId]
        );

        if (expenses.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Expense not found'
            });
        }

        await pool.execute(
            `DELETE FROM expenses WHERE id = UUID_TO_BIN(?)`,
            [expenseId]
        );

        res.json({
            success: true,
            message: 'Expense deleted successfully'
        });
    } catch (err) {
        console.error('Error deleting expense:', err);
        res.status(500).json({
            success: false,
            message: 'Error deleting expense'
        });
    }
});

module.exports = router;