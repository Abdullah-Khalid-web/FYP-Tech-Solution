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
            SELECT 
                s.user_id, 
                s.status, 
                s.net_amount, 
                s.amount,
                COALESCE(s.bonus, 0) as bonus,
                COALESCE(s.fine, 0) as fine
            FROM ${req.tablePrefix}user_salaries s
            WHERE s.month = ?
        `, [currentMonth]);

        // Get active loans total amount
        const [activeLoans] = await pool.execute(`
            SELECT user_id, SUM(due_amount) as total_due
            FROM ${req.tablePrefix}user_loans 
            WHERE status = 'active' AND due_amount > 0
            GROUP BY user_id
        `);

        // Process employees with additional data
        const processedEmployees = employees.map(emp => {
            const salary = currentSalaries.find(s => s.user_id === emp.id);
            const loans = activeLoans.find(l => l.user_id === emp.id);
            
            return {
                ...emp,
                salary_status: salary ? salary.status : 'not set',
                total_active_loans: loans ? parseFloat(loans.total_due) : 0,
                current_salary: salary
            };
        });

        // Get stats
        const [[stats]] = await pool.execute(`
            SELECT 
                COUNT(*) as totalEmployees,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as activeEmployees
            FROM users
            WHERE shop_id = ?
        `, [req.session.shopId]);

        const [[salaryStats]] = await pool.execute(`
            SELECT COUNT(*) as pendingSalaries
            FROM ${req.tablePrefix}user_salaries 
            WHERE month = ? AND status = 'pending'
        `, [currentMonth]);

        const [[loanStats]] = await pool.execute(`
            SELECT COUNT(*) as activeLoans
            FROM ${req.tablePrefix}user_loans 
            WHERE status = 'active' AND due_amount > 0
        `);

        const totalStats = {
            totalEmployees: parseInt(stats.totalEmployees) || 0,
            activeEmployees: parseInt(stats.activeEmployees) || 0,
            pendingSalaries: parseInt(salaryStats.pendingSalaries) || 0,
            activeLoans: parseInt(loanStats.activeLoans) || 0
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
            buildQueryString: buildQueryString
        });

    } catch (err) {
        console.error('Error fetching employees:', err);
        res.status(500).render('error', {
            message: 'Failed to load employees',
            shop: req.shop
        });
    }
});

// API Routes

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

// PUT /api/employees/:id - Update employee
router.put('/api/EmpMgmt/:id', getShopPrefix, async (req, res) => {
    let connection;
    try {
        const employeeId = req.params.id;
        const { name, email, phone, cnic, role, salary, status, notes } = req.body;

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

        // Update employee
        await connection.execute(`
            UPDATE users 
            SET name = ?, email = ?, phone = ?, cnic = ?, role = ?, salary = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND shop_id = ?
        `, [name, email, phone || null, cnic || null, role, salary || null, status, notes || null, employeeId, req.session.shopId]);

        await connection.commit();

        res.json({
            success: true,
            message: 'Employee updated successfully'
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error updating employee:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to update employee'
        });
    } finally {
        if (connection) connection.release();
    }
});

// PUT /api/employees/:id/status - Update employee status
router.put('/api/EmpMgmt/:id/status', getShopPrefix, async (req, res) => {
    try {
        const employeeId = req.params.id;
        const { status } = req.body;

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

        // Update employee status
        await pool.execute(`
            UPDATE users 
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND shop_id = ?
        `, [status, employeeId, req.session.shopId]);

        res.json({
            success: true,
            message: `Employee ${status === 'active' ? 'activated' : 'deactivated'} successfully`
        });

    } catch (err) {
        console.error('Error updating employee status:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to update employee status'
        });
    }
});

// PUT /api/employees/:id/salary - Update employee salary
router.put('/api/EmpMgmt/:id/salary', getShopPrefix, async (req, res) => {
    let connection;
    try {
        const employeeId = req.params.id;
        const { salary, reason, effective_date } = req.body;

        // Check if employee exists
        const [[employee]] = await pool.execute(`
            SELECT id, salary as old_salary FROM users WHERE id = ? AND shop_id = ?
        `, [employeeId, req.session.shopId]);

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Update employee salary
        await connection.execute(`
            UPDATE users 
            SET salary = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND shop_id = ?
        `, [salary, employeeId, req.session.shopId]);

        // Record salary history
        await connection.execute(`
            INSERT INTO ${req.tablePrefix}salary_history 
            (user_id, old_salary, new_salary, reason, effective_date)
            VALUES (?, ?, ?, ?, ?)
        `, [employeeId, employee.old_salary, salary, reason || 'Salary adjustment', effective_date || new Date()]);

        await connection.commit();

        res.json({
            success: true,
            message: 'Salary updated successfully',
            oldSalary: employee.old_salary,
            newSalary: salary
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error updating salary:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to update salary'
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

        // Get salary adjustment history
        const [salaryHistory] = await pool.execute(`
            SELECT * FROM ${req.tablePrefix}salary_history 
            WHERE user_id = ? 
            ORDER BY effective_date DESC
        `, [employeeId]);

        // Calculate total active loan amount
        const [totalLoans] = await pool.execute(`
            SELECT SUM(due_amount) as total_due 
            FROM ${req.tablePrefix}user_loans 
            WHERE user_id = ? AND status = 'active' AND due_amount > 0
        `, [employeeId]);

        res.json({
            success: true,
            employee: employee,
            salaries: salaries,
            loans: loans,
            salaryHistory: salaryHistory,
            totalActiveLoans: totalLoans[0]?.total_due || 0
        });

    } catch (err) {
        console.error('Error fetching employee details:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load employee details'
        });
    }
});

// GET active loans for employee
router.get('/api/EmpMgmt/:id/loans/active', getShopPrefix, async (req, res) => {
    try {
        const employeeId = req.params.id;
        
        const [loans] = await pool.execute(`
            SELECT * FROM ${req.tablePrefix}user_loans 
            WHERE user_id = ? AND status = 'active' AND due_amount > 0
            ORDER BY taken_on ASC
        `, [employeeId]);

        res.json({
            success: true,
            loans: loans
        });
    } catch (err) {
        console.error('Error fetching active loans:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load active loans'
        });
    }
});

// POST simplified salary payment with installment support
router.post('/api/EmpMgmt/:id/salary/simple', getShopPrefix, async (req, res) => {
    let connection;
    try {
        const employeeId = req.params.id;
        const { month, amount, bonus, fine, loan_deductions, notes } = req.body;

        if (!month || !amount) {
            return res.status(400).json({
                success: false,
                message: 'Month and amount are required'
            });
        }

        // Check if employee exists
        const [[employee]] = await pool.execute(`
            SELECT id, salary FROM users WHERE id = ? AND shop_id = ?
        `, [employeeId, req.session.shopId]);

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Calculate net amount
        let netAmount = parseFloat(amount) + (parseFloat(bonus) || 0) - (parseFloat(fine) || 0);
        let totalLoanDeductions = 0;
        let processedLoans = [];

        // Process loan deductions
        if (loan_deductions && loan_deductions.length > 0) {
            for (const deduction of loan_deductions) {
                const [loan] = await connection.execute(
                    `SELECT * FROM ${req.tablePrefix}user_loans WHERE id = ? AND user_id = ? AND status = 'active'`,
                    [deduction.loan_id, employeeId]
                );

                if (loan.length > 0) {
                    const currentLoan = loan[0];
                    let actualDeduction = 0;
                    
                    // If loan has installment amount, use that, otherwise use the requested amount
                    if (currentLoan.installment && currentLoan.installment > 0) {
                        // Use installment amount, but don't exceed due amount
                        actualDeduction = Math.min(currentLoan.installment, currentLoan.due_amount);
                    } else {
                        // Use the manually entered amount, but don't exceed due amount
                        actualDeduction = Math.min(deduction.amount, currentLoan.due_amount);
                    }
                    
                    const newDueAmount = currentLoan.due_amount - actualDeduction;
                    const newStatus = newDueAmount <= 0 ? 'paid' : 'active';

                    await connection.execute(`
                        UPDATE ${req.tablePrefix}user_loans 
                        SET due_amount = ?, status = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `, [newDueAmount, newStatus, deduction.loan_id]);

                    totalLoanDeductions += actualDeduction;
                    processedLoans.push({
                        loan_id: deduction.loan_id,
                        amount: actualDeduction,
                        previous_due: currentLoan.due_amount,
                        new_due: newDueAmount
                    });
                    
                    // Record transaction
                    await connection.execute(`
                        INSERT INTO ${req.tablePrefix}loan_transactions 
                        (loan_id, amount, type, description) 
                        VALUES (?, ?, 'salary_deduction', ?)
                    `, [deduction.loan_id, actualDeduction, `Salary deduction for ${month} - ${currentLoan.reason}`]);
                }
            }
            netAmount -= totalLoanDeductions;
        }

        // Ensure net amount is not negative
        if (netAmount < 0) {
            netAmount = 0;
        }

        // Save salary record
        const [existing] = await connection.execute(`
            SELECT id FROM ${req.tablePrefix}user_salaries 
            WHERE user_id = ? AND month = ?
        `, [employeeId, month]);

        const bonusValue = parseFloat(bonus) || 0;
        const fineValue = parseFloat(fine) || 0;

        if (existing.length > 0) {
            await connection.execute(`
                UPDATE ${req.tablePrefix}user_salaries 
                SET amount = ?, net_amount = ?, bonus = ?, fine = ?, 
                    status = 'paid', paid_on = CURRENT_DATE, notes = ?
                WHERE user_id = ? AND month = ?
            `, [amount, netAmount, bonusValue, fineValue, notes, employeeId, month]);
        } else {
            await connection.execute(`
                INSERT INTO ${req.tablePrefix}user_salaries 
                (user_id, month, amount, net_amount, bonus, fine, status, paid_on, notes)
                VALUES (?, ?, ?, ?, ?, ?, 'paid', CURRENT_DATE, ?)
            `, [employeeId, month, amount, netAmount, bonusValue, fineValue, notes]);
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Salary paid successfully',
            netAmount: netAmount,
            totalDeductions: totalLoanDeductions,
            processedLoans: processedLoans
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error processing salary:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to process salary payment'
        });
    } finally {
        if (connection) connection.release();
    }
});

// POST simplified loan with installment support
router.post('/api/EmpMgmt/:id/loan/simple', getShopPrefix, async (req, res) => {
    let connection;
    try {
        const employeeId = req.params.id;
        const { amount, repayment_type, installments, installment_amount, reason, taken_on } = req.body;

        if (!amount || !reason) {
            return res.status(400).json({
                success: false,
                message: 'Amount and reason are required'
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

        const loanAmount = parseFloat(amount);
        let installmentAmount = null;
        let dueAmount = loanAmount;

        // Calculate installment if repayment type is installments
        if (repayment_type === 'installments') {
            if (installment_amount) {
                installmentAmount = parseFloat(installment_amount);
            } else if (installments) {
                installmentAmount = Math.ceil(loanAmount / parseInt(installments));
            }
        }

        // Insert loan record
        const [result] = await connection.execute(`
            INSERT INTO ${req.tablePrefix}user_loans 
            (user_id, amount, due_amount, installment, repayment_type, status, reason, taken_on)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
        `, [employeeId, loanAmount, dueAmount, installmentAmount, repayment_type, reason, taken_on || new Date()]);

        await connection.commit();

        res.json({
            success: true,
            message: 'Loan added successfully',
            loanId: result.insertId,
            installmentAmount: installmentAmount
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error adding loan:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to add loan'
        });
    } finally {
        if (connection) connection.release();
    }
});

// PUT /api/EmpMgmt/loans/:loanId - Update loan
router.put('/api/EmpMgmt/loans/:loanId', getShopPrefix, async (req, res) => {
    let connection;
    try {
        const loanId = req.params.loanId;
        const { amount, due_amount, installment, reason, status } = req.body;

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Update loan
        await connection.execute(`
            UPDATE ${req.tablePrefix}user_loans 
            SET amount = ?, due_amount = ?, installment = ?, reason = ?, status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [amount, due_amount, installment, reason, status, loanId]);

        await connection.commit();

        res.json({
            success: true,
            message: 'Loan updated successfully'
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error updating loan:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to update loan'
        });
    } finally {
        if (connection) connection.release();
    }
});

// POST loan payment
router.post('/api/EmpMgmt/:id/loan/payment', getShopPrefix, async (req, res) => {
    let connection;
    try {
        const employeeId = req.params.id;
        const { amount, payment_date, notes } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Valid payment amount is required'
            });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Get active loans
        const [activeLoans] = await connection.execute(`
            SELECT * FROM ${req.tablePrefix}user_loans 
            WHERE user_id = ? AND status = 'active' AND due_amount > 0
            ORDER BY taken_on ASC
        `, [employeeId]);

        if (activeLoans.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No active loans found'
            });
        }

        let remainingAmount = parseFloat(amount);
        let loansUpdated = 0;
        let processedLoans = [];

        // Distribute payment across loans
        for (const loan of activeLoans) {
            if (remainingAmount <= 0) break;

            const paymentForThisLoan = Math.min(remainingAmount, loan.due_amount);
            const newDueAmount = loan.due_amount - paymentForThisLoan;
            const newStatus = newDueAmount <= 0 ? 'paid' : 'active';

            await connection.execute(`
                UPDATE ${req.tablePrefix}user_loans 
                SET due_amount = ?, status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [newDueAmount, newStatus, loan.id]);

            // Record transaction
            await connection.execute(`
                INSERT INTO ${req.tablePrefix}loan_transactions 
                (loan_id, amount, type, description) 
                VALUES (?, ?, 'payment', ?)
            `, [loan.id, paymentForThisLoan, notes || `Direct loan payment on ${payment_date}`]);

            remainingAmount -= paymentForThisLoan;
            loansUpdated++;
            
            processedLoans.push({
                loan_id: loan.id,
                amount: paymentForThisLoan,
                previous_due: loan.due_amount,
                new_due: newDueAmount
            });
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Loan payment processed successfully',
            loansUpdated: loansUpdated,
            amountPaid: amount - remainingAmount,
            processedLoans: processedLoans
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error processing loan payment:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to process loan payment'
        });
    } finally {
        if (connection) connection.release();
    }
});

// Bulk pay salaries
router.post('/api/EmpMgmt/salaries/bulk-pay', getShopPrefix, async (req, res) => {
    let connection;
    try {
        const currentMonth = new Date().toISOString().slice(0, 7);
        
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Get all active employees
        const [employees] = await connection.execute(`
            SELECT id, salary FROM users 
            WHERE shop_id = ? AND status = 'active' AND salary IS NOT NULL
        `, [req.session.shopId]);

        let processed = 0;

        for (const emp of employees) {
            // Check if salary already paid for this month
            const [existing] = await connection.execute(`
                SELECT id FROM ${req.tablePrefix}user_salaries 
                WHERE user_id = ? AND month = ? AND status = 'paid'
            `, [emp.id, currentMonth]);

            if (existing.length === 0) {
                // Insert salary record
                await connection.execute(`
                    INSERT INTO ${req.tablePrefix}user_salaries 
                    (user_id, month, amount, net_amount, status, paid_on)
                    VALUES (?, ?, ?, ?, 'paid', CURRENT_DATE)
                `, [emp.id, currentMonth, emp.salary, emp.salary]);
                processed++;
            }
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Bulk payment completed',
            processed: processed,
            total: employees.length
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error processing bulk payment:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to process bulk payment'
        });
    } finally {
        if (connection) connection.release();
    }
});

// DELETE /api/employees/:id - Delete employee
router.delete('/api/EmpMgmt/:id', getShopPrefix, async (req, res) => {
    let connection;
    try {
        const employeeId = req.params.id;

        // Check if employee exists and belongs to this shop
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

module.exports = router;