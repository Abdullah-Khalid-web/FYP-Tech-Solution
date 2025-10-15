const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Middleware to get shop-specific table prefix
const getShopPrefix = async (req, res, next) => {
    if (!req.session.shopId) {
        return res.status(403).json({ success: false, message: 'Shop not identified' });
    }

    req.tablePrefix = `shop_${req.session.shopId}_`;

    try {
        // Get shop details from database
        const [shops] = await pool.execute(
            'SELECT * FROM shops WHERE id = ?',
            [req.session.shopId]
        );

        req.shop = {
            id: req.session.shopId,
            name: shops[0]?.name || 'My Shop',
            logo: shops[0]?.logo ? `/uploads/${shops[0].logo}` : '/images/default-logo.png',
            currency: shops[0]?.currency || 'PKR',
            primary_color: shops[0]?.primary_color || '#007bff',
            secondary_color: shops[0]?.secondary_color || '#6c757d'
        };

        next();
    } catch (err) {
        console.error('Error fetching shop details:', err);
        req.shop = {
            id: req.session.shopId,
            name: 'My Shop',
            logo: '/images/default-logo.png',
            currency: 'PKR',
            primary_color: '#007bff',
            secondary_color: '#6c757d'
        };
        next();
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
router.get('/', getShopPrefix, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        
        const { category, date_from, date_to, payment_method } = req.query;

        let whereClause = 'WHERE 1=1';
        const queryParams = [];

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
                e.*,
                u.name as created_by_name
             FROM ${req.tablePrefix}expenses e
             LEFT JOIN users u ON e.created_by = u.id
             ${whereClause}
             ORDER BY e.expense_date DESC, e.created_at DESC
             LIMIT ? OFFSET ?`,
            [...queryParams, limit, offset]
        );

        // Get total count for pagination
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM ${req.tablePrefix}expenses e ${whereClause}`,
            queryParams
        );
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Get summary statistics
        const [todaySummary] = await pool.execute(
            `SELECT COALESCE(SUM(amount), 0) as total 
             FROM ${req.tablePrefix}expenses 
             WHERE expense_date = CURDATE()`
        );

        const [monthSummary] = await pool.execute(
            `SELECT COALESCE(SUM(amount), 0) as total 
             FROM ${req.tablePrefix}expenses 
             WHERE YEAR(expense_date) = YEAR(CURDATE()) 
             AND MONTH(expense_date) = MONTH(CURDATE())`
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
router.post('/', getShopPrefix, async (req, res) => {
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
            `INSERT INTO ${req.tablePrefix}expenses 
             (category, description, amount, expense_date, payment_method, receipt_number, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
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
router.get('/statistics', getShopPrefix, async (req, res) => {
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
             FROM ${req.tablePrefix}expenses
             WHERE expense_date >= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)
             GROUP BY category
             ORDER BY total_amount DESC`
        );

        // Time-based summary
        const [timeSummary] = await pool.execute(
            `SELECT 
                DATE_FORMAT(expense_date, '${dateFormat}') as period,
                COUNT(*) as count,
                SUM(amount) as total_amount
             FROM ${req.tablePrefix}expenses
             WHERE expense_date >= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)
             GROUP BY ${groupBy}
             ORDER BY period DESC
             LIMIT 12`
        );

        // User-wise summary
        const [userSummary] = await pool.execute(
            `SELECT 
                u.name,
                COUNT(e.id) as expense_count,
                SUM(e.amount) as total_amount
             FROM ${req.tablePrefix}expenses e
             LEFT JOIN users u ON e.created_by = u.id
             WHERE e.expense_date >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
             GROUP BY e.created_by, u.name
             ORDER BY total_amount DESC`
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
router.delete('/:id', getShopPrefix, async (req, res) => {
    try {
        const expenseId = req.params.id;

        // Verify expense exists and belongs to this shop
        const [expenses] = await pool.execute(
            `SELECT id FROM ${req.tablePrefix}expenses WHERE id = ?`,
            [expenseId]
        );

        if (expenses.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Expense not found'
            });
        }

        await pool.execute(
            `DELETE FROM ${req.tablePrefix}expenses WHERE id = ?`,
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