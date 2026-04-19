const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Middleware to get shop-specific details
const getShopDetails = async (req, res, next) => {
    if (!req.session.shopId) {
        return res.status(403).json({ success: false, message: 'Shop not identified' });
    }

    try {
        const [shops] = await pool.execute(
            'SELECT * FROM shops WHERE id = UUID_TO_BIN(?)',
            [req.session.shopId]
        );

        if (shops.length === 0) {
            return res.status(404).json({ success: false, message: 'Shop not found' });
        }

        req.shop = {
            id: req.session.shopId,
            name: shops[0].name || 'My Shop',
            logo: shops[0].logo ? `/uploads/${shops[0].logo}` : '/images/default-logo.png',
            currency: shops[0].currency || 'PKR',
            primary_color: shops[0].primary_color || '#007bff',
            secondary_color: shops[0].secondary_color || '#6c757d'
        };

        next();
    } catch (err) {
        console.error('Error fetching shop details:', err);
        res.status(500).json({ success: false, message: 'Error fetching shop details' });
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
router.get('/', getShopDetails, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;

        // Get all roles first
        const [roles] = await pool.execute(`
            SELECT BIN_TO_UUID(id) as id, role_name 
            FROM roles 
            WHERE status = 'active'
        `);

        // Build filter conditions
        let whereConditions = ['u.shop_id = UUID_TO_BIN(?)'];
        let queryParams = [req.session.shopId];

        // Role filter
        if (req.query.role && req.query.role !== 'all') {
            const role = roles.find(r => r.role_name === req.query.role);
            if (role) {
                whereConditions.push('u.role_id = UUID_TO_BIN(?)');
                queryParams.push(role.id);
            }
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

        // Get filtered employees with role_name
        const [employees] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(u.id) as id,
                u.name,
                u.email,
                u.phone,
                u.cnic,
                r.role_name as role,
                u.salary,
                u.status,
                u.notes,
                u.created_at
            FROM users u
            LEFT JOIN roles r ON u.role_id = r.id
            ${whereClause}
            ORDER BY u.created_at DESC
            LIMIT ? OFFSET ?
        `, [...queryParams, limit, offset]);

        // Get total count for pagination
        const [[{ total }]] = await pool.execute(`
            SELECT COUNT(*) as total 
            FROM users u
            LEFT JOIN roles r ON u.role_id = r.id
            ${whereClause}
        `, queryParams);

        // Get current month for salary status
        const currentMonth = new Date().toISOString().slice(0, 7);

        // Get salary data for current month
        const [currentSalaries] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(user_id) as user_id,
                status,
                net_amount,
                amount,
                COALESCE(bonus, 0) as bonus,
                COALESCE(fine, 0) as fine
            FROM user_salary
            WHERE shop_id = UUID_TO_BIN(?) AND month = ?
        `, [req.session.shopId, currentMonth]);

        // Get active loans total amount
        const [activeLoans] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(user_id) as user_id,
                SUM(total_balance) as total_due
            FROM user_loan 
            WHERE shop_id = UUID_TO_BIN(?) AND status = 'active'
            GROUP BY user_id
        `, [req.session.shopId]);

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
            WHERE shop_id = UUID_TO_BIN(?)
        `, [req.session.shopId]);

        const [[salaryStats]] = await pool.execute(`
            SELECT COUNT(*) as pendingSalaries
            FROM user_salary 
            WHERE shop_id = UUID_TO_BIN(?) AND month = ? AND status = 'pending'
        `, [req.session.shopId, currentMonth]);

        const [[loanStats]] = await pool.execute(`
            SELECT COUNT(DISTINCT user_id) as activeLoans
            FROM user_loan 
            WHERE shop_id = UUID_TO_BIN(?) AND status = 'active'
        `, [req.session.shopId]);

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
            roles: roles,
            currentPage: page,
            totalPages: totalPages,
            totalStats: totalStats,
            shop: req.shop,
            query: req.query,
            buildQueryString: buildQueryString,
            shopCurrency: req.shop.currency
        });

    } catch (err) {
        console.error('Error fetching employees:', err);
        res.status(500).render('error', {
            message: 'Failed to load employees',
            shop: req.shop
        });
    }
});

// POST /api/employees - Add new employee
router.post('/api/EmpMgmt', getShopDetails, async (req, res) => {
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
            'SELECT id FROM users WHERE email = ? AND shop_id = UUID_TO_BIN(?)',
            [email, req.session.shopId]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Email already exists'
            });
        }

        // Get role_id from role_name
        const [roleResult] = await pool.execute(
            'SELECT id FROM roles WHERE role_name = ?',
            [role]
        );

        if (roleResult.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid role selected'
            });
        }

        const roleId = roleResult[0].id;

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = crypto.randomBytes(16);

        // Insert new employee
        await connection.execute(`
            INSERT INTO users (id, shop_id, role_id, name, email, phone, cnic, salary, password, status, notes)
            VALUES (?, UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, ?, 'active', ?)
        `, [userId, req.session.shopId, roleId, name, email, phone || null, cnic || null, salary || null, hashedPassword, notes || null]);

        await connection.commit();

        res.json({
            success: true,
            message: 'Employee added successfully',
            employeeId: crypto.createHash('sha256').update(userId).digest('hex')
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
router.put('/api/EmpMgmt/:id', getShopDetails, async (req, res) => {
    let connection;
    try {
        const employeeId = req.params.id;
        const { name, email, phone, cnic, role, salary, status, notes } = req.body;

        // Check if employee exists
        const [[employee]] = await pool.execute(`
            SELECT id FROM users WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
        `, [employeeId, req.session.shopId]);

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Get role_id from role_name
        const [roleResult] = await pool.execute(
            'SELECT id FROM roles WHERE role_name = ?',
            [role]
        );

        if (roleResult.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid role selected'
            });
        }

        const roleId = roleResult[0].id;

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Update employee
        await connection.execute(`
            UPDATE users 
            SET name = ?, email = ?, phone = ?, cnic = ?, role_id = ?, salary = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
        `, [name, email, phone || null, cnic || null, roleId, salary || null, status, notes || null, employeeId, req.session.shopId]);

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
router.put('/api/EmpMgmt/:id/status', getShopDetails, async (req, res) => {
    try {
        const employeeId = req.params.id;
        const { status } = req.body;

        // Check if employee exists
        const [[employee]] = await pool.execute(`
            SELECT id FROM users WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
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
            WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
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

// GET /api/employees/:id - Get employee details with loans and salary history
router.get('/api/EmpMgmt/:id', getShopDetails, async (req, res) => {
    try {
        const employeeId = req.params.id;

        // Get employee basic info with role_name
        const [[employee]] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(u.id) as id,
                u.name,
                u.email,
                u.phone,
                u.cnic,
                r.role_name as role,
                u.salary,
                u.status,
                u.notes,
                u.created_at
            FROM users u
            LEFT JOIN roles r ON u.role_id = r.id
            WHERE u.id = UUID_TO_BIN(?) AND u.shop_id = UUID_TO_BIN(?)
        `, [employeeId, req.session.shopId]);

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Get salary history (last 12 months)
        const [salaries] = await pool.execute(`
            SELECT 
                month,
                amount,
                bonus,
                fine,
                net_amount,
                paid_on,
                status,
                notes
            FROM user_salary 
            WHERE user_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
            ORDER BY month DESC
            LIMIT 12
        `, [employeeId, req.session.shopId]);

        // Get loan ledger transactions
        const [loanLedger] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(l.id) as loan_id,
                l.loan_number,
                ll.transaction_type,
                ll.amount,
                ll.description,
                ll.payment_method,
                ll.created_at
            FROM user_loan_ledger ll
            JOIN user_loan l ON ll.loan_id = l.id
            WHERE ll.user_id = UUID_TO_BIN(?) AND ll.shop_id = UUID_TO_BIN(?)
            ORDER BY ll.created_at DESC
            LIMIT 50
        `, [employeeId, req.session.shopId]);

        // Get active loans (balance > 0)
        const [activeLoans] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(id) as id,
                loan_number,
                loan_type,
                total_amount,
                total_paid,
                total_balance,
                installments,
                installment_amount,
                description,
                loan_date,
                status,
                created_at
            FROM user_loan 
            WHERE user_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?) AND status = 'active'
            ORDER BY loan_date ASC
        `, [employeeId, req.session.shopId]);

        // Calculate total loan balance
        const [[loanBalance]] = await pool.execute(`
            SELECT COALESCE(SUM(total_balance), 0) as total_balance 
            FROM user_loan 
            WHERE user_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?) AND status = 'active'
        `, [employeeId, req.session.shopId]);

        res.json({
            success: true,
            employee: employee,
            salaries: salaries,
            loanLedger: loanLedger,
            activeLoans: activeLoans,
            totalLoanBalance: parseFloat(loanBalance.total_balance) || 0
        });

    } catch (err) {
        console.error('Error fetching employee details:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load employee details'
        });
    }
});

// POST /api/employees/:id/salary - Pay salary with loan deduction
router.post('/api/EmpMgmt/:id/salary', getShopDetails, async (req, res) => {
    let connection;
    try {
        const employeeId = req.params.id;
        const { month, amount, bonus, fine, loan_deductions, notes, paid_on } = req.body;

        if (!month || !amount) {
            return res.status(400).json({
                success: false,
                message: 'Month and amount are required'
            });
        }

        // Check if employee exists
        const [[employee]] = await pool.execute(`
            SELECT id, salary FROM users WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
        `, [employeeId, req.session.shopId]);

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        let netAmount = parseFloat(amount) + (parseFloat(bonus) || 0) - (parseFloat(fine) || 0);
        let totalLoanDeductions = 0;
        let processedLoans = [];

        // Process loan deductions if any
        if (loan_deductions && loan_deductions.length > 0) {
            for (const deduction of loan_deductions) {
                if (deduction.amount > 0) {
                    // Get current loan balance
                    const [loan] = await connection.execute(`
                        SELECT id, total_balance, installment_amount FROM user_loan 
                        WHERE id = UUID_TO_BIN(?) AND user_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?) AND status = 'active'
                    `, [deduction.loan_id, employeeId, req.session.shopId]);

                    if (loan.length > 0 && loan[0].total_balance > 0) {
                        const loanRecord = loan[0];
                        const deductionAmount = Math.min(parseFloat(deduction.amount), loanRecord.total_balance);
                        
                        // Record loan repayment in ledger (debit = payment made by employee)
                        const ledgerId = crypto.randomBytes(16);
                        await connection.execute(`
                            INSERT INTO user_loan_ledger (id, loan_id, shop_id, user_id, transaction_type, amount, description, payment_method, reference_type, created_by)
                            VALUES (?, UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), 'debit', ?, ?, 'salary_deduction', 'salary_deduction', UUID_TO_BIN(?))
                        `, [
                            ledgerId,
                            deduction.loan_id,
                            req.session.shopId,
                            employeeId,
                            deductionAmount,
                            `Salary deduction for ${month} - Installment payment`,
                            req.session.userId || null
                        ]);

                        totalLoanDeductions += deductionAmount;
                        processedLoans.push({
                            loan_id: deduction.loan_id,
                            amount: deductionAmount,
                            previous_balance: loanRecord.total_balance,
                            new_balance: loanRecord.total_balance - deductionAmount
                        });
                    }
                }
            }
            netAmount -= totalLoanDeductions;
        }

        // Ensure net amount is not negative
        if (netAmount < 0) netAmount = 0;

        // Check if salary already exists for this month
        const [existingSalary] = await connection.execute(`
            SELECT id FROM user_salary 
            WHERE user_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?) AND month = ?
        `, [employeeId, req.session.shopId, month]);

        const salaryId = crypto.randomBytes(16);

        if (existingSalary.length > 0) {
            // Update existing salary
            await connection.execute(`
                UPDATE user_salary 
                SET amount = ?, bonus = ?, fine = ?, net_amount = ?, 
                    status = 'paid', paid_on = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?) AND month = ?
            `, [amount, bonus || 0, fine || 0, netAmount, paid_on || new Date(), notes, employeeId, req.session.shopId, month]);
        } else {
            // Insert new salary record
            await connection.execute(`
                INSERT INTO user_salary (id, shop_id, user_id, amount, bonus, fine, net_amount, month, paid_on, status, notes)
                VALUES (?, UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, 'paid', ?)
            `, [salaryId, req.session.shopId, employeeId, amount, bonus || 0, fine || 0, netAmount, month, paid_on || new Date(), notes]);
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
            message: 'Failed to process salary payment: ' + err.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// POST /api/employees/:id/loan - Add new loan
// POST /api/employees/:id/loan - Add new loan
router.post('/api/EmpMgmt/:id/loan', getShopDetails, async (req, res) => {
    let connection;
    try {
        const employeeId = req.params.id;
        const { amount, description, loan_type, installments } = req.body;

        if (!amount || !description) {
            return res.status(400).json({
                success: false,
                message: 'Amount and description are required'
            });
        }

        // Check if employee exists
        const [[employee]] = await pool.execute(`
            SELECT id FROM users WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
        `, [employeeId, req.session.shopId]);

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Generate loan number
        const shopPrefix = 'LOAN'; // You can customize this
        const [[loanNumberResult]] = await connection.execute(`
            SELECT CONCAT(?, '-', DATE_FORMAT(NOW(), '%Y%m%d'), '-', 
                   LPAD(COALESCE(MAX(SUBSTRING(loan_number, -4)), 0) + 1, 4, '0')) as loan_number
            FROM user_loan 
            WHERE shop_id = UUID_TO_BIN(?) 
            AND loan_number LIKE CONCAT(?, '-', DATE_FORMAT(NOW(), '%Y%m%d'), '-%')
        `, [shopPrefix, req.session.shopId, shopPrefix]);

        const loanNumber = loanNumberResult.loan_number || 
                          `${shopPrefix}-${new Date().toISOString().slice(0,10).replace(/-/g, '')}-0001`;

        const loanId = crypto.randomBytes(16);
        const loanAmount = parseFloat(amount);
        const numInstallments = parseInt(installments) || 1;
        const installmentAmount = loan_type === 'installment' ? 
            Math.ceil(loanAmount / numInstallments) : null;

        console.log('Creating loan with ID:', loanId.toString('hex'));
        console.log('Loan number:', loanNumber);
        console.log('Loan amount:', loanAmount);
        console.log('Installments:', numInstallments);

        // Insert loan record
        await connection.execute(`
            INSERT INTO user_loan (id, shop_id, user_id, loan_number, loan_type, total_amount, installments, installment_amount, description, loan_date, status, created_by)
            VALUES (?, UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, ?, 'active', UUID_TO_BIN(?))
        `, [
            loanId,
            req.session.shopId,
            employeeId,
            loanNumber,
            loan_type || 'full',
            loanAmount,
            numInstallments,
            installmentAmount,
            description,
            new Date().toISOString().split('T')[0],
            req.session.userId || null
        ]);

        console.log('Loan record inserted successfully');

        // Record loan given in ledger (credit = loan given to employee)
        const ledgerId = crypto.randomBytes(16);
        console.log('Creating ledger entry with loan ID:', loanId);
        
        await connection.execute(`
            INSERT INTO user_loan_ledger (id, loan_id, shop_id, user_id, transaction_type, amount, description, created_by)
            VALUES (?, ?, UUID_TO_BIN(?), UUID_TO_BIN(?), 'credit', ?, ?, UUID_TO_BIN(?))
        `, [
            ledgerId,
            loanId, // Use the actual loanId variable, not a string
            req.session.shopId,
            employeeId,
            loanAmount,
            `Loan given: ${description}`,
            req.session.userId || null
        ]);

        console.log('Ledger entry created successfully');

        await connection.commit();

        res.json({
            success: true,
            message: 'Loan added successfully',
            loanId: crypto.createHash('sha256').update(loanId).digest('hex'),
            loanNumber: loanNumber
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error adding loan:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to add loan: ' + err.message,
            error: err.sqlMessage
        });
    } finally {
        if (connection) connection.release();
    }
});

// POST /api/employees/:id/loan/payment - Make loan payment
router.post('/api/EmpMgmt/:id/loan/payment', getShopDetails, async (req, res) => {
    let connection;
    try {
        const employeeId = req.params.id;
        const { amount, description, loan_id, payment_method } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Valid payment amount is required'
            });
        }

        // Check if employee exists
        const [[employee]] = await pool.execute(`
            SELECT id FROM users WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
        `, [employeeId, req.session.shopId]);

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        let paymentAmount = parseFloat(amount);
        let processedLoans = [];

        if (loan_id) {
            // Pay specific loan
            const [loan] = await connection.execute(`
                SELECT id, total_balance FROM user_loan 
                WHERE id = UUID_TO_BIN(?) AND user_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?) AND status = 'active'
            `, [loan_id, employeeId, req.session.shopId]);

            if (loan.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'Active loan not found'
                });
            }

            const loanRecord = loan[0];
            const paymentToLoan = Math.min(paymentAmount, loanRecord.total_balance);
            
            // Record loan repayment in ledger
            const ledgerId = crypto.randomBytes(16);
            await connection.execute(`
                INSERT INTO user_loan_ledger (id, loan_id, shop_id, user_id, transaction_type, amount, description, payment_method, reference_type, created_by)
                VALUES (?, UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), 'debit', ?, ?, ?, 'direct_payment', UUID_TO_BIN(?))
            `, [
                ledgerId,
                loan_id,
                req.session.shopId,
                employeeId,
                paymentToLoan,
                description || 'Direct loan payment',
                payment_method || 'cash',
                req.session.userId || null
            ]);

            processedLoans.push({
                loan_id: loan_id,
                amount: paymentToLoan,
                remaining: loanRecord.total_balance - paymentToLoan
            });

        } else {
            // Pay against all active loans (FIFO - oldest first)
            const [activeLoans] = await connection.execute(`
                SELECT id, total_balance FROM user_loan 
                WHERE user_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?) AND status = 'active'
                ORDER BY loan_date ASC
            `, [employeeId, req.session.shopId]);

            let remainingPayment = paymentAmount;

            for (const loan of activeLoans) {
                if (remainingPayment <= 0) break;

                const loanBalance = parseFloat(loan.total_balance);
                const paymentToLoan = Math.min(remainingPayment, loanBalance);
                
                if (paymentToLoan > 0) {
                    // Record loan repayment in ledger
                    const ledgerId = crypto.randomBytes(16);
                    await connection.execute(`
                        INSERT INTO user_loan_ledger (id, loan_id, shop_id, user_id, transaction_type, amount, description, payment_method, reference_type, created_by)
                        VALUES (?, UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), 'debit', ?, ?, ?, 'direct_payment', UUID_TO_BIN(?))
                    `, [
                        ledgerId,
                        loan.id,
                        req.session.shopId,
                        employeeId,
                        paymentToLoan,
                        `${description || 'Direct payment'} - Partial payment`,
                        payment_method || 'cash',
                        req.session.userId || null
                    ]);

                    processedLoans.push({
                        loan_id: loan.id,
                        amount: paymentToLoan,
                        remaining: loanBalance - paymentToLoan
                    });

                    remainingPayment -= paymentToLoan;
                }
            }

            if (remainingPayment > 0) {
                // Return overpayment as change or record as advance
                await connection.execute(`
                    INSERT INTO user_loan_ledger (id, shop_id, user_id, transaction_type, amount, description, payment_method, reference_type, created_by)
                    VALUES (?, UUID_TO_BIN(?), UUID_TO_BIN(?), 'debit', ?, ?, ?, 'adjustment', UUID_TO_BIN(?))
                `, [
                    crypto.randomBytes(16),
                    req.session.shopId,
                    employeeId,
                    remainingPayment,
                    `Change from overpayment: ${description || 'Direct payment'}`,
                    payment_method || 'cash',
                    req.session.userId || null
                ]);
            }
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Loan payment processed successfully',
            amountPaid: paymentAmount,
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

// DELETE /api/employees/:id - Delete employee
router.delete('/api/EmpMgmt/:id', getShopDetails, async (req, res) => {
    let connection;
    try {
        const employeeId = req.params.id;

        // Check if employee exists and belongs to this shop
        const [[employee]] = await pool.execute(`
            SELECT id FROM users WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
        `, [employeeId, req.session.shopId]);

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Check if employee has any pending loans
        const [[pendingLoans]] = await pool.execute(`
            SELECT COUNT(*) as count FROM user_loan 
            WHERE user_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?) AND status = 'active'
        `, [employeeId, req.session.shopId]);

        if (parseInt(pendingLoans.count) > 0) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete employee with pending loans'
            });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Delete employee loan records
        await connection.execute(`
            DELETE FROM user_loan WHERE user_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
        `, [employeeId, req.session.shopId]);

        // Delete employee salary records
        await connection.execute(`
            DELETE FROM user_salary WHERE user_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
        `, [employeeId, req.session.shopId]);

        // Delete employee
        await connection.execute(`
            DELETE FROM users WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
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

// GET /api/roles - Get all roles
router.get('/api/EmpMgmt/roles', getShopDetails, async (req, res) => {
    try {
        const [roles] = await pool.execute(`
            SELECT BIN_TO_UUID(id) as id, role_name 
            FROM roles 
            WHERE status = 'active'
            ORDER BY role_name
        `);

        res.json({
            success: true,
            roles: roles
        });
    } catch (err) {
        console.error('Error fetching roles:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch roles'
        });
    }
});

// GET /api/employees/:id/loans - Get employee loans
router.get('/api/EmpMgmt/:id/loans', getShopDetails, async (req, res) => {
    try {
        const employeeId = req.params.id;

        const [loans] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(id) as id,
                loan_number,
                loan_type,
                total_amount,
                total_paid,
                total_balance,
                installments,
                installment_amount,
                description,
                loan_date,
                status,
                created_at
            FROM user_loan 
            WHERE user_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
            ORDER BY loan_date DESC
        `, [employeeId, req.session.shopId]);

        res.json({
            success: true,
            loans: loans
        });
    } catch (err) {
        console.error('Error fetching employee loans:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch loans'
        });
    }
});

// GET /api/employees/:id/loan/:loanId/ledger - Get loan ledger
router.get('/api/EmpMgmt/:id/loan/:loanId/ledger', getShopDetails, async (req, res) => {
    try {
        const { id, loanId } = req.params;

        const [ledger] = await pool.execute(`
            SELECT 
                transaction_type,
                amount,
                description,
                payment_method,
                created_at
            FROM user_loan_ledger
            WHERE loan_id = UUID_TO_BIN(?) AND user_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
            ORDER BY created_at DESC
        `, [loanId, id, req.session.shopId]);

        res.json({
            success: true,
            ledger: ledger
        });
    } catch (err) {
        console.error('Error fetching loan ledger:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch loan ledger'
        });
    }
});

module.exports = router;