const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const bcrypt = require('bcryptjs');

// Middleware to get shop-specific table prefix and details
const getShopPrefix = async (req, res, next) => {
    if (!req.session.shopId) {
        return res.status(403).json({ success: false, message: 'Shop not identified' });
    }

    req.tablePrefix = `shop_${req.session.shopId}_`;

    try {
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

// Helper function for building query strings in EJS
function buildQueryString(query) {
    const params = [];
    if (query.role && query.role !== 'all') params.push(`role=${query.role}`);
    if (query.status && query.status !== 'all') params.push(`status=${query.status}`);
    if (query.search) params.push(`search=${encodeURIComponent(query.search)}`);
    if (query.salaryRange && query.salaryRange !== 'all') params.push(`salaryRange=${query.salaryRange}`);

    return params.length > 0 ? '&' + params.join('&') : '';
}

// GET /employees - Show all employees with pagination and filtering
router.get('/', getShopPrefix, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;

        // Build filter conditions
        let whereConditions = ['u.shop_id = ?'];
        let queryParams = [req.session.shopId];

        // Role filter
        if (req.query.role && req.query.role !== 'all') {
            whereConditions.push('u.role = ?');
            queryParams.push(req.query.role);
        }

        // Status filter
        if (req.query.status && req.query.status !== 'all') {
            whereConditions.push('u.status = ?');
            queryParams.push(req.query.status);
        }

        // Search filter
        if (req.query.search) {
            whereConditions.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
            queryParams.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`);
        }

        // Salary range filter
        if (req.query.salaryRange && req.query.salaryRange !== 'all') {
            switch (req.query.salaryRange) {
                case 'low':
                    whereConditions.push('u.salary < 20000');
                    break;
                case 'medium':
                    whereConditions.push('u.salary >= 20000 AND u.salary <= 50000');
                    break;
                case 'high':
                    whereConditions.push('u.salary > 50000');
                    break;
            }
        }

        // Build WHERE clause
        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // Get filtered employees
        const [employees] = await pool.execute(`
            SELECT u.* 
            FROM users u
            ${whereClause}
            ORDER BY u.created_at DESC
            LIMIT ? OFFSET ?
        `, [...queryParams, limit, offset]);

        // Get total count for pagination
        const [[{ total }]] = await pool.execute(`
            SELECT COUNT(*) as total 
            FROM users u
            ${whereClause}
        `, queryParams);

        // Get current month for salary status
        const currentMonth = new Date().toISOString().slice(0, 7);

        // Get salary data for current month
        const [currentSalaries] = await pool.execute(`
            SELECT s.user_id, s.status 
            FROM ${req.tablePrefix}user_salaries s
            WHERE s.month = ?
        `, [currentMonth]);

        // Get active loans count
        const [activeLoans] = await pool.execute(`
            SELECT user_id, COUNT(*) as loan_count 
            FROM ${req.tablePrefix}user_loans 
            WHERE status = 'active'
            GROUP BY user_id
        `);

        // Process employees with additional data
        const processedEmployees = employees.map(emp => {
            const salary = currentSalaries.find(s => s.user_id === emp.id);
            const loans = activeLoans.find(l => l.user_id === emp.id);
            
            return {
                ...emp,
                salary_status: salary ? salary.status : 'not set',
                active_loans: loans ? loans.loan_count : 0
            };
        });

        // Get stats
        const [[stats]] = await pool.execute(`
            SELECT 
                COUNT(*) as totalEmployees,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as activeEmployees,
                (SELECT COUNT(*) FROM ${req.tablePrefix}user_salaries WHERE month = ? AND status = 'pending') as pendingSalaries,
                (SELECT COUNT(*) FROM ${req.tablePrefix}user_loans WHERE status = 'active') as activeLoans
            FROM users
            WHERE shop_id = ?
        `, [currentMonth, req.session.shopId]);

        const totalStats = {
            totalEmployees: parseInt(stats.totalEmployees) || 0,
            activeEmployees: parseInt(stats.activeEmployees) || 0,
            pendingSalaries: parseInt(stats.pendingSalaries) || 0,
            activeLoans: parseInt(stats.activeLoans) || 0
        };

        const totalPages = Math.ceil(total / limit);

        res.render('EmpMgmt', {
            title: 'Employee Management',
            employees: processedEmployees,
            currentPage: page,
            totalPages: totalPages,
            totalStats: totalStats,
            shop: req.shop,
            query: req.query,
            buildQueryString: buildQueryString // Make helper available in EJS
        });

    } catch (err) {
        console.error('Error fetching employees:', err);
        res.status(500).render('error', {
            message: 'Failed to load employees',
            shop: req.shop
        });
    }
});

// API Routes for AJAX calls

// GET /api/employees - Get employees data for AJAX
router.get('/api/EmpMgmt', getShopPrefix, async (req, res) => {
    try {
        // Build filter conditions
        let whereConditions = ['u.shop_id = ?'];
        let queryParams = [req.session.shopId];

        // Role filter
        if (req.query.role && req.query.role !== 'all') {
            whereConditions.push('u.role = ?');
            queryParams.push(req.query.role);
        }

        // Status filter
        if (req.query.status && req.query.status !== 'all') {
            whereConditions.push('u.status = ?');
            queryParams.push(req.query.status);
        }

        // Search filter
        if (req.query.search) {
            whereConditions.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
            queryParams.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // Get employees
        const [employees] = await pool.execute(`
            SELECT u.* 
            FROM users u
            ${whereClause}
            ORDER BY u.created_at DESC
        `, queryParams);

        // Get current month for salary status
        const currentMonth = new Date().toISOString().slice(0, 7);

        // Get salary data
        const [salaries] = await pool.execute(`
            SELECT * FROM ${req.tablePrefix}user_salaries 
            WHERE month = ?
        `, [currentMonth]);

        // Get loan data
        const [loans] = await pool.execute(`
            SELECT * FROM ${req.tablePrefix}user_loans 
            WHERE status = 'active'
        `);

        res.json({
            success: true,
            employees: employees,
            salaries: salaries,
            loans: loans
        });

    } catch (err) {
        console.error('Error fetching employees API:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load employees'
        });
    }
});

// POST /api/employees - Add new employee
router.post('/api/EmpMgmt', getShopPrefix, async (req, res) => {
    let connection;
    try {
        const { name, email, phone, cnic, role, salary, password, notes } = req.body;

        // Validate required fields
        if (!name || !email || !password || !role) {
            return res.status(400).json({
                success: false,
                message: 'Name, email, password, and role are required'
            });
        }

        // Check if email already exists
        const [existingUsers] = await pool.execute(
            'SELECT id FROM users WHERE email = ? AND shop_id = ?',
            [email, req.session.shopId]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Email already exists'
            });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert new employee
        const [result] = await connection.execute(`
            INSERT INTO users (shop_id, name, email, phone, cnic, role, salary, password, status, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
        `, [req.session.shopId, name, email, phone || null, cnic || null, role, salary || null, hashedPassword, notes || null]);

        await connection.commit();

        res.json({
            success: true,
            message: 'Employee added successfully',
            employeeId: result.insertId
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error adding employee:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to add employee'
        });
    } finally {
        if (connection) connection.release();
    }
});

// GET /api/employees/:id - Get employee details
router.get('/api/EmpMgmt/:id', getShopPrefix, async (req, res) => {
    try {
        const employeeId = req.params.id;

        // Get employee basic info
        const [[employee]] = await pool.execute(`
            SELECT * FROM users WHERE id = ? AND shop_id = ?
        `, [employeeId, req.session.shopId]);

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Get salary history
        const [salaries] = await pool.execute(`
            SELECT * FROM ${req.tablePrefix}user_salaries 
            WHERE user_id = ? 
            ORDER BY month DESC
        `, [employeeId]);

        // Get loan history
        const [loans] = await pool.execute(`
            SELECT * FROM ${req.tablePrefix}user_loans 
            WHERE user_id = ? 
            ORDER BY taken_on DESC
        `, [employeeId]);

        res.json({
            success: true,
            employee: employee,
            salaries: salaries,
            loans: loans
        });

    } catch (err) {
        console.error('Error fetching employee details:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load employee details'
        });
    }
});

// DELETE /api/employees/:id - Delete employee
router.delete('/api/EmpMgmt/:id', getShopPrefix, async (req, res) => {
    let connection;
    try {
        const employeeId = req.params.id;

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Check if employee exists and belongs to this shop
        const [[employee]] = await connection.execute(`
            SELECT id FROM users WHERE id = ? AND shop_id = ?
        `, [employeeId, req.session.shopId]);

        if (!employee) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Delete employee salaries
        await connection.execute(`
            DELETE FROM ${req.tablePrefix}user_salaries WHERE user_id = ?
        `, [employeeId]);

        // Delete employee loans
        await connection.execute(`
            DELETE FROM ${req.tablePrefix}user_loans WHERE user_id = ?
        `, [employeeId]);

        // Delete employee
        await connection.execute(`
            DELETE FROM users WHERE id = ? AND shop_id = ?
        `, [employeeId, req.session.shopId]);

        await connection.commit();

        res.json({
            success: true,
            message: 'Employee deleted successfully'
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error deleting employee:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to delete employee'
        });
    } finally {
        if (connection) connection.release();
    }
});

// POST /api/employees/:id/salary - Add/Update employee salary
router.post('/api/EmpMgmt/:id/salary', getShopPrefix, async (req, res) => {
    let connection;
    try {
        const employeeId = req.params.id;
        const { month, amount, status, paid_on, notes } = req.body;

        // Validate required fields
        if (!month || !amount || !status) {
            return res.status(400).json({
                success: false,
                message: 'Month, amount, and status are required'
            });
        }

        // Check if employee exists
        const [[employee]] = await pool.execute(`
            SELECT id FROM users WHERE id = ? AND shop_id = ?
        `, [employeeId, req.session.shopId]);

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Check if salary record already exists for this month
        const [existingSalaries] = await connection.execute(`
            SELECT id FROM ${req.tablePrefix}user_salaries 
            WHERE user_id = ? AND month = ?
        `, [employeeId, month]);

        if (existingSalaries.length > 0) {
            // Update existing salary
            await connection.execute(`
                UPDATE ${req.tablePrefix}user_salaries 
                SET amount = ?, status = ?, paid_on = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ? AND month = ?
            `, [amount, status, paid_on || null, notes || null, employeeId, month]);
        } else {
            // Insert new salary record
            await connection.execute(`
                INSERT INTO ${req.tablePrefix}user_salaries (user_id, month, amount, status, paid_on, notes)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [employeeId, month, amount, status, paid_on || null, notes || null]);
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Salary saved successfully'
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error saving salary:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to save salary'
        });
    } finally {
        if (connection) connection.release();
    }
});

// POST /api/employees/:id/loan - Add employee loan
router.post('/api/EmpMgmt/:id/loan', getShopPrefix, async (req, res) => {
    let connection;
    try {
        const employeeId = req.params.id;
        const { amount, taken_on, reason, status, installment, due_amount, notes } = req.body;

        // Validate required fields
        if (!amount || !taken_on || !reason || !status) {
            return res.status(400).json({
                success: false,
                message: 'Amount, taken date, reason, and status are required'
            });
        }

        // Check if employee exists
        const [[employee]] = await pool.execute(`
            SELECT id FROM users WHERE id = ? AND shop_id = ?
        `, [employeeId, req.session.shopId]);

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Insert new loan record
        const [result] = await connection.execute(`
            INSERT INTO ${req.tablePrefix}user_loans (user_id, amount, taken_on, reason, status, installment, due_amount, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [employeeId, amount, taken_on, reason, status, installment || null, due_amount || amount, notes || null]);

        await connection.commit();

        res.json({
            success: true,
            message: 'Loan saved successfully',
            loanId: result.insertId
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error saving loan:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to save loan'
        });
    } finally {
        if (connection) connection.release();
    }
});

// GET /api/shop/current - Get current shop info
router.get('/api/shop/current', getShopPrefix, async (req, res) => {
    try {
        res.json({
            success: true,
            shop: req.shop
        });
    } catch (err) {
        console.error('Error fetching shop info:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load shop information'
        });
    }
});

module.exports = router;