const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Middleware to get shop-specific data
const getShopData = async (req, res, next) => {
    if (!req.session.shopId) {
        return res.status(403).json({ success: false, message: 'Shop not identified' });
    }

    try {
        // Get shop details from database
        const [shops] = await pool.execute(
            'SELECT * FROM shops WHERE id = UUID_TO_BIN(?)',
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

// GET suppliers listing
router.get('/', getShopData, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;

        // Get suppliers with balance information
        const [suppliers] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(s.id) as id,
                s.name,
                s.contact_person,
                s.email,
                s.phone,
                s.address,
                s.city,
                s.country,
                s.tax_number,
                s.payment_terms,
                s.account_number,
                s.bank_name,
                s.notes,
                s.type,
                s.status,
                s.created_at,
                COALESCE(sb.total_debit, 0) as total_debit,
                COALESCE(sb.total_credit, 0) as total_credit,
                COALESCE(sb.balance, 0) as balance
             FROM suppliers s
             LEFT JOIN supplier_balance sb ON s.id = sb.supplier_id
             WHERE s.shop_id = UUID_TO_BIN(?)
             ORDER BY s.created_at DESC 
             LIMIT ? OFFSET ?`,
            [req.session.shopId, limit, offset]
        );

        // Get total count for pagination
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM suppliers WHERE shop_id = UUID_TO_BIN(?)`,
            [req.session.shopId]
        );
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Get distinct cities for filter dropdown
        const [citiesResult] = await pool.execute(
            `SELECT DISTINCT city FROM suppliers 
             WHERE shop_id = UUID_TO_BIN(?) AND city IS NOT NULL AND city != ''`,
            [req.session.shopId]
        );
        const cities = citiesResult.map(item => item.city);

        res.render('suppliers/index', {
            title: 'Suppliers',
            suppliers,
            cities,
            currentPage: page,
            totalPages,
            shop: req.shop || {}
        });
    } catch (err) {
        console.error('Error fetching suppliers:', err);
        res.status(500).render('error', {
            title: 'Error',
            message: 'An error occurred while fetching suppliers'
        });
    }
});

// POST create new supplier
router.post('/', getShopData, async (req, res) => {
    try {
        const {
            name, contact_person, email, phone, address, city, country,
            tax_number, payment_terms, account_number, bank_name, notes, type
        } = req.body;

        // Validate required fields
        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'Supplier name is required'
            });
        }

        const supplierId = require('crypto').randomUUID();
        await pool.execute(
            `INSERT INTO suppliers 
             (id, shop_id, name, contact_person, email, phone, address, city, country,
              tax_number, payment_terms, account_number, bank_name, notes, type, status)
             VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [
                supplierId,
                req.session.shopId,
                name,
                contact_person || null,
                email || null,
                phone || null,
                address || null,
                city || null,
                country || null,
                tax_number || null,
                payment_terms || null,
                account_number || null,
                bank_name || null,
                notes || null,
                type || 'both'
            ]
        );

        // Initialize supplier balance
        await pool.execute(
            `INSERT INTO supplier_balance (shop_id, supplier_id, total_debit, total_credit)
             VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), 0, 0)`,
            [req.session.shopId, supplierId]
        );

        res.json({ 
            success: true, 
            message: 'Supplier added successfully',
            supplierId: supplierId
        });
    } catch (err) {
        console.error('Error creating supplier:', err);
        res.status(500).json({
            success: false,
            message: 'Error creating supplier'
        });
    }
});

// GET supplier for editing
router.get('/:id/edit', getShopData, async (req, res) => {
    try {
        const supplierId = req.params.id;

        const [suppliers] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(id) as id,
                name,
                contact_person,
                email,
                phone,
                address,
                city,
                country,
                tax_number,
                payment_terms,
                account_number,
                bank_name,
                notes,
                type,
                status
             FROM suppliers 
             WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [supplierId, req.session.shopId]
        );

        if (suppliers.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Supplier not found'
            });
        }

        res.json({
            success: true,
            supplier: suppliers[0]
        });
    } catch (err) {
        console.error('Error fetching supplier for edit:', err);
        res.status(500).json({
            success: false,
            message: 'Error loading supplier details'
        });
    }
});

// PUT update supplier
router.put('/:id', getShopData, async (req, res) => {
    try {
        const {
            name, contact_person, email, phone, address, city, country,
            tax_number, payment_terms, account_number, bank_name, notes, type
        } = req.body;

        await pool.execute(
            `UPDATE suppliers 
             SET name = ?, contact_person = ?, email = ?, phone = ?, address = ?, 
                 city = ?, country = ?, tax_number = ?, payment_terms = ?, 
                 account_number = ?, bank_name = ?, notes = ?, type = ?, updated_at = NOW()
             WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [
                name,
                contact_person || null,
                email || null,
                phone || null,
                address || null,
                city || null,
                country || null,
                tax_number || null,
                payment_terms || null,
                account_number || null,
                bank_name || null,
                notes || null,
                type || 'both',
                req.params.id,
                req.session.shopId
            ]
        );

        res.json({
            success: true,
            message: 'Supplier updated successfully'
        });
    } catch (err) {
        console.error('Error updating supplier:', err);
        res.status(500).json({
            success: false,
            message: 'Error updating supplier'
        });
    }
});

// POST toggle supplier status
router.post('/:id/toggle-status', getShopData, async (req, res) => {
    try {
        await pool.execute(
            `UPDATE suppliers 
             SET status = CASE WHEN status = 'active' THEN 'inactive' ELSE 'active' END 
             WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [req.params.id, req.session.shopId]
        );

        res.json({ success: true, message: 'Supplier status updated' });
    } catch (err) {
        console.error('Error toggling supplier status:', err);
        res.status(500).json({ success: false, message: 'Error toggling supplier status' });
    }
});

// GET supplier ledger (transactions)
router.get('/:id/ledger', getShopData, async (req, res) => {
    try {
        const supplierId = req.params.id;
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;

        // Get supplier info
        const [supplierInfo] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(id) as id,
                name,
                contact_person,
                phone,
                email
             FROM suppliers 
             WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [supplierId, req.session.shopId]
        );

        if (supplierInfo.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Supplier not found'
            });
        }

        // Get transactions
        const [transactions] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(st.id) as id,
                st.type,
                st.amount,
                st.description,
                st.reference_type,
                st.reference_id,
                DATE(st.created_at) as date,
                TIME(st.created_at) as time,
                u.name as created_by_name
             FROM supplier_transactions st
             LEFT JOIN users u ON st.created_by = u.id
             WHERE st.supplier_id = UUID_TO_BIN(?) AND st.shop_id = UUID_TO_BIN(?)
             ORDER BY st.created_at DESC
             LIMIT ? OFFSET ?`,
            [supplierId, req.session.shopId, limit, offset]
        );

        // Get balance info
        const [balanceInfo] = await pool.execute(
            `SELECT 
                total_debit,
                total_credit,
                balance,
                updated_at
             FROM supplier_balance 
             WHERE supplier_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [supplierId, req.session.shopId]
        );

        // Get total transaction count for pagination
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM supplier_transactions 
             WHERE supplier_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [supplierId, req.session.shopId]
        );
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        res.json({
            success: true,
            supplier: supplierInfo[0],
            transactions: transactions,
            balance: balanceInfo[0] || { total_debit: 0, total_credit: 0, balance: 0 },
            currentPage: page,
            totalPages: totalPages
        });
    } catch (err) {
        console.error('Error fetching supplier ledger:', err);
        res.status(500).json({
            success: false,
            message: 'Error loading supplier ledger'
        });
    }
});

// POST add transaction to supplier ledger
router.post('/:id/transactions', getShopData, async (req, res) => {
    try {
        const supplierId = req.params.id;
        const { type, amount, description, reference_type, reference_id } = req.body;

        if (!type || !amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Type and valid amount are required'
            });
        }

        const transactionId = require('crypto').randomUUID();
        
        // Start transaction
        await pool.query('START TRANSACTION');

        try {
            // Insert transaction
            await pool.execute(
                `INSERT INTO supplier_transactions 
                 (id, shop_id, supplier_id, type, amount, description, reference_type, reference_id, created_by)
                 VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?, ?, ?, ?, UUID_TO_BIN(?))`,
                [
                    transactionId,
                    req.session.shopId,
                    supplierId,
                    type,
                    parseFloat(amount),
                    description || null,
                    reference_type || 'other',
                    reference_id || null,
                    req.session.userId
                ]
            );

            // Update supplier balance
            if (type === 'debit') {
                await pool.execute(
                    `INSERT INTO supplier_balance (shop_id, supplier_id, total_debit, total_credit)
                     VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?)
                     ON DUPLICATE KEY UPDATE 
                     total_debit = total_debit + VALUES(total_debit),
                     updated_at = NOW()`,
                    [req.session.shopId, supplierId, parseFloat(amount), 0]
                );
            } else if (type === 'credit') {
                await pool.execute(
                    `INSERT INTO supplier_balance (shop_id, supplier_id, total_debit, total_credit)
                     VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?)
                     ON DUPLICATE KEY UPDATE 
                     total_credit = total_credit + VALUES(total_credit),
                     updated_at = NOW()`,
                    [req.session.shopId, supplierId, 0, parseFloat(amount)]
                );
            }

            await pool.query('COMMIT');
            
            res.json({ 
                success: true, 
                message: 'Transaction added successfully',
                transactionId: transactionId
            });
        } catch (err) {
            await pool.query('ROLLBACK');
            throw err;
        }
    } catch (err) {
        console.error('Error adding transaction:', err);
        res.status(500).json({
            success: false,
            message: 'Error adding transaction'
        });
    }
});


// GET supplier ledger report page - FIXED VERSION
router.get('/reports/ledger', getShopData, async (req, res) => {
    try {
        console.log('Loading ledger report page for shop:', req.shop.id);
        
        // First, let's check what suppliers exist
        const [allSuppliers] = await pool.execute(
            `SELECT COUNT(*) as count FROM suppliers WHERE shop_id = UUID_TO_BIN(?)`,
            [req.shop.id]
        );
        console.log('Total suppliers in database:', allSuppliers[0].count);

        // Get all suppliers for dropdown
        const [suppliers] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(id) as id,
                name,
                contact_person,
                phone,
                email
             FROM suppliers 
             WHERE shop_id = UUID_TO_BIN(?) AND status = 'active'
             ORDER BY name ASC`,
            [req.shop.id]
        );

        console.log('Suppliers found for dropdown:', suppliers.length);

        // If no suppliers found, show empty state but still render the page
        if (suppliers.length === 0) {
            console.log('No suppliers found for this shop');
        }

        res.render('suppliers/ledger-report', {
            title: 'Supplier Ledger Report',
            suppliers: suppliers,
            shop: req.shop || {}
        });
    } catch (err) {
        console.error('Error loading ledger report page:', err);
        res.status(500).render('error', {
            title: 'Error',
            message: 'An error occurred while loading the report page: ' + err.message,
            shop: req.shop || {}
        });
    }
});

// POST generate ledger report - FIXED VERSION
router.post('/reports/ledger/generate', getShopData, async (req, res) => {
    try {
        console.log('Generating ledger report with data:', req.body);
        const { supplier_id, start_date, end_date, report_type } = req.body;
        
        console.log('Shop ID:', req.shop.id);
        console.log('Supplier ID:', supplier_id);
        
        // First check if we have any suppliers
        const [supplierCheck] = await pool.execute(
            `SELECT COUNT(*) as count FROM suppliers WHERE shop_id = UUID_TO_BIN(?)`,
            [req.shop.id]
        );
        
        if (supplierCheck[0].count === 0) {
            return res.json({
                success: true,
                transactions: [],
                summary: { total_transactions: 0, total_debit: 0, total_credit: 0, net_balance: 0 },
                supplierBalances: [],
                filters: req.body,
                message: 'No suppliers found for this shop'
            });
        }

        let query = `
            SELECT 
                BIN_TO_UUID(st.id) as id,
                st.type,
                st.amount,
                st.description,
                st.reference_type,
                st.reference_id,
                DATE(st.created_at) as date,
                TIME(st.created_at) as time,
                u.name as created_by_name,
                s.name as supplier_name,
                s.contact_person,
                s.phone
            FROM supplier_transactions st
            JOIN suppliers s ON st.supplier_id = s.id
            LEFT JOIN users u ON st.created_by = u.id
            WHERE st.shop_id = UUID_TO_BIN(?)
        `;
        
        const params = [req.shop.id];
        
        if (supplier_id && supplier_id !== 'all') {
            // Verify supplier exists
            const [supplierExists] = await pool.execute(
                `SELECT COUNT(*) as count FROM suppliers WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
                [supplier_id, req.shop.id]
            );
            
            if (supplierExists[0].count === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Supplier not found'
                });
            }
            
            query += ` AND st.supplier_id = UUID_TO_BIN(?)`;
            params.push(supplier_id);
        }
        
        if (start_date) {
            query += ` AND DATE(st.created_at) >= ?`;
            params.push(start_date);
        }
        
        if (end_date) {
            query += ` AND DATE(st.created_at) <= ?`;
            params.push(end_date);
        }
        
        query += ` ORDER BY st.created_at DESC`;
        
        console.log('Executing query:', query);
        console.log('With params:', params);
        
        const [transactions] = await pool.execute(query, params);
        console.log('Transactions found:', transactions.length);
        
        // Get summary data with COALESCE to handle null values
        let summaryQuery = `
            SELECT 
                COALESCE(COUNT(*), 0) as total_transactions,
                COALESCE(SUM(CASE WHEN st.type = 'debit' THEN st.amount ELSE 0 END), 0) as total_debit,
                COALESCE(SUM(CASE WHEN st.type = 'credit' THEN st.amount ELSE 0 END), 0) as total_credit,
                COALESCE(SUM(CASE WHEN st.type = 'debit' THEN st.amount ELSE 0 END), 0) - 
                COALESCE(SUM(CASE WHEN st.type = 'credit' THEN st.amount ELSE 0 END), 0) as net_balance
            FROM supplier_transactions st
            WHERE st.shop_id = UUID_TO_BIN(?)
        `;
        
        const summaryParams = [req.shop.id];
        
        if (supplier_id && supplier_id !== 'all') {
            summaryQuery += ` AND st.supplier_id = UUID_TO_BIN(?)`;
            summaryParams.push(supplier_id);
        }
        
        if (start_date) {
            summaryQuery += ` AND DATE(st.created_at) >= ?`;
            summaryParams.push(start_date);
        }
        
        if (end_date) {
            summaryQuery += ` AND DATE(st.created_at) <= ?`;
            summaryParams.push(end_date);
        }
        
        const [summary] = await pool.execute(summaryQuery, summaryParams);
        console.log('Summary:', summary[0]);
        
        // Get individual supplier balances if "all" is selected
        let supplierBalances = [];
        if (supplier_id === 'all') {
            // First get all active suppliers
            const [allSuppliers] = await pool.execute(
                `SELECT 
                    BIN_TO_UUID(id) as id,
                    name
                 FROM suppliers 
                 WHERE shop_id = UUID_TO_BIN(?) AND status = 'active'
                 ORDER BY name`,
                [req.shop.id]
            );
            
            console.log('All active suppliers:', allSuppliers.length);
            
            // For each supplier, get their balance
            for (const supplier of allSuppliers) {
                let balanceQuery = `
                    SELECT 
                        COALESCE(SUM(CASE WHEN st.type = 'debit' THEN st.amount ELSE 0 END), 0) as total_debit,
                        COALESCE(SUM(CASE WHEN st.type = 'credit' THEN st.amount ELSE 0 END), 0) as total_credit
                    FROM supplier_transactions st
                    WHERE st.supplier_id = UUID_TO_BIN(?) AND st.shop_id = UUID_TO_BIN(?)
                `;
                
                const balanceParams = [supplier.id, req.shop.id];
                
                if (start_date) {
                    balanceQuery += ` AND DATE(st.created_at) >= ?`;
                    balanceParams.push(start_date);
                }
                
                if (end_date) {
                    balanceQuery += ` AND DATE(st.created_at) <= ?`;
                    balanceParams.push(end_date);
                }
                
                const [balanceResult] = await pool.execute(balanceQuery, balanceParams);
                
                supplierBalances.push({
                    supplier_name: supplier.name,
                    total_debit: balanceResult[0]?.total_debit || 0,
                    total_credit: balanceResult[0]?.total_credit || 0,
                    balance: (balanceResult[0]?.total_debit || 0) - (balanceResult[0]?.total_credit || 0)
                });
            }
            
            console.log('Supplier balances calculated:', supplierBalances.length);
        }
        
        res.json({
            success: true,
            transactions: transactions,
            summary: summary[0] || { total_transactions: 0, total_debit: 0, total_credit: 0, net_balance: 0 },
            supplierBalances: supplierBalances,
            filters: {
                supplier_id: supplier_id,
                start_date: start_date,
                end_date: end_date,
                report_type: report_type
            }
        });
    } catch (err) {
        console.error('Error generating ledger report:', err);
        res.status(500).json({
            success: false,
            message: 'Error generating report: ' + err.message
        });
    }
});

// Add a debug route to check your database
router.get('/debug/db-check', async (req, res) => {
    try {
        // Check shops table
        const [shops] = await pool.execute('SELECT BIN_TO_UUID(id) as id, name FROM shops LIMIT 5');
        
        // Check suppliers table
        const [suppliers] = await pool.execute('SELECT BIN_TO_UUID(id) as id, BIN_TO_UUID(shop_id) as shop_id, name FROM suppliers LIMIT 5');
        
        // Check supplier_transactions table
        const [transactions] = await pool.execute('SELECT COUNT(*) as count FROM supplier_transactions');
        
        res.json({
            shops: shops,
            suppliers: suppliers,
            transaction_count: transactions[0].count,
            session_shopId: req.session.shopId
        });
    } catch (err) {
        res.json({ error: err.message });
    }
});

// Keep all your other routes the same...
// [All your existing routes for /, /:id/edit, /:id, etc.]

module.exports = router;