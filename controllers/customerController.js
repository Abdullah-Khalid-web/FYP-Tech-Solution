const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const crypto = require('crypto');

// Helper function to generate UUID
const generateUUID = () => crypto.randomUUID();

// Helper function to convert UUID to binary for MySQL
const uuidToBin = (uuid) => {
    if (!uuid) return null;
    // Remove hyphens and convert to buffer
    const hex = uuid.replace(/-/g, '');
    return Buffer.from(hex, 'hex');
};

// Helper function to convert binary to UUID string
const binToUuid = (buffer) => {
    if (!buffer) return null;
    const hex = buffer.toString('hex');
    return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}`;
};

// Middleware to get shop details
const getShopDetails = async (req, res, next) => {
    if (!req.session || !req.session.shopId) {
        console.error('No shopId in session');
        return res.status(403).json({ success: false, message: 'Shop not identified' });
    }

    try {
        console.log('Fetching shop details for ID:', req.session.shopId);
        
        const [shops] = await pool.execute(
            'SELECT *, BIN_TO_UUID(id) as id_str FROM shops WHERE id = UUID_TO_BIN(?)',
            [req.session.shopId]
        );

        if (shops.length === 0) {
            console.error('Shop not found for ID:', req.session.shopId);
            return res.status(404).json({ success: false, message: 'Shop not found' });
        }

        req.shop = {
            id: req.session.shopId,
            name: shops[0].name || 'My Shop',
            logo: shops[0].logo ? `/uploads/${shops[0].logo}` : '/images/default-logo.png',
            currency: shops[0].currency || 'PKR',
            primary_color: shops[0].primary_color || '#4e73df',
            secondary_color: shops[0].secondary_color || '#858796'
        };

        console.log('Shop details fetched successfully');
        next();
    } catch (err) {
        console.error('Error fetching shop details:', err);
        res.status(500).json({ success: false, message: 'Error fetching shop details' });
    }
};

// Debug route - place this at the top of your router, after getShopDetails middleware
router.get('/test', getShopDetails, (req, res) => {
    res.json({ 
        success: true, 
        message: 'Customers API is working',
        shop: req.shop 
    });
});

// GET /customers - Main customers page
router.get('/', getShopDetails, async (req, res) => {
    try {
        console.log('Loading customers page for shop:', req.shop.id);
        
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const offset = (page - 1) * limit;

        // Get total count for pagination
        let countQuery = 'SELECT COUNT(*) as total FROM customers WHERE shop_id = UUID_TO_BIN(?)';
        let countParams = [req.shop.id];

        if (search) {
            countQuery += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)';
            const searchTerm = `%${search}%`;
            countParams.push(searchTerm, searchTerm, searchTerm);
        }

        const [countResult] = await pool.execute(countQuery, countParams);
        const totalCustomers = countResult[0].total;
        const totalPages = Math.ceil(totalCustomers / limit);

        // Get customers with pagination
        let customersQuery = `
            SELECT 
                BIN_TO_UUID(id) as id,
                name,
                phone,
                email,
                address,
                type,
                city,
                country,
                notes,
                discount,
                credit_limit,
                created_at,
                updated_at
            FROM customers 
            WHERE shop_id = UUID_TO_BIN(?)
        `;
        let customersParams = [req.shop.id];

        if (search) {
            customersQuery += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)';
            const searchTerm = `%${search}%`;
            customersParams.push(searchTerm, searchTerm, searchTerm);
        }

        customersQuery += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        customersParams.push(limit, offset);

        const [customers] = await pool.execute(customersQuery, customersParams);
        console.log(`Found ${customers.length} customers`);

        // Get customer statistics
        const [statsResult] = await pool.execute(`
            SELECT 
                COUNT(*) as total_customers,
                COUNT(DISTINCT phone) as unique_phones,
                COUNT(DISTINCT email) as unique_emails,
                DATE(MAX(created_at)) as last_added,
                DATE(MIN(created_at)) as first_added
            FROM customers 
            WHERE shop_id = UUID_TO_BIN(?)
        `, [req.shop.id]);

        const stats = statsResult[0] || {
            total_customers: 0,
            unique_phones: 0,
            unique_emails: 0,
            last_added: null,
            first_added: null
        };

        // Get top customers by purchase count
        const [topCustomers] = await pool.execute(`
            SELECT 
                c.name,
                c.phone,
                COUNT(b.id) as purchase_count,
                COALESCE(SUM(b.total_amount), 0) as total_spent,
                MAX(b.created_at) as last_purchase
            FROM customers c
            LEFT JOIN bills b ON c.id = b.customer_id AND b.shop_id = UUID_TO_BIN(?)
            WHERE c.shop_id = UUID_TO_BIN(?)
            GROUP BY c.id
            ORDER BY total_spent DESC
            LIMIT 10
        `, [req.shop.id, req.shop.id]);

        res.render('customers/index', {
            title: 'Customer Management',
            shop: req.shop,
            customers: customers,
            stats: stats,
            topCustomers: topCustomers,
            pagination: {
                currentPage: page,
                totalPages: totalPages,
                limit: limit,
                totalCustomers: totalCustomers
            },
            search: search
        });

    } catch (err) {
        console.error('Error loading customers:', err);
        res.status(500).render('error', {
            message: 'Failed to load customers',
            shop: req.shop,
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// POST /customers - Add new customer (FIXED VERSION)
router.post('/', getShopDetails, async (req, res) => {
    let connection;
    try {
        const { name, phone, email, address, type, city, country, notes, reference, discount, credit_limit } = req.body;

        console.log('=== ADD CUSTOMER REQUEST ===');
        console.log('Shop ID:', req.shop.id);
        console.log('Request Body:', req.body);

        // Validate required fields - ONLY NAME IS REQUIRED
        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Name is required'
            });
        }

        // Get database connection
        connection = await pool.getConnection();
        
        // Check if shop exists
        const [shopCheck] = await connection.execute(
            'SELECT BIN_TO_UUID(id) as id FROM shops WHERE id = UUID_TO_BIN(?)',
            [req.shop.id]
        );

        if (shopCheck.length === 0) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Shop not found'
            });
        }

        // Generate UUID for new customer
        const customerId = generateUUID();
        console.log('Generated customer ID:', customerId);

        // Convert to binary
        const customerIdBinary = uuidToBin(customerId);
        const shopIdBinary = uuidToBin(req.shop.id);

        // Prepare values (handle nulls properly)
        const nameValue = name.trim();
        
        // Handle phone (optional)
        let phoneValue = null;
        if (phone && phone.trim()) {
            phoneValue = phone.replace(/\D/g, '');
            if (phoneValue.length > 0 && phoneValue.length !== 11) {
                connection.release();
                return res.status(400).json({
                    success: false,
                    message: 'Phone number must be 11 digits'
                });
            }
        }

        const emailValue = email && email.trim() ? email.trim() : null;
        const addressValue = address && address.trim() ? address.trim() : null;
        const typeValue = type || 'regular';
        const cityValue = city && city.trim() ? city.trim() : null;
        const countryValue = country && country.trim() ? country.trim() : 'Pakistan';
        const notesValue = notes && notes.trim() ? notes.trim() : null;
        const referenceValue = reference && reference.trim() ? reference.trim() : null;
        const discountValue = discount ? parseFloat(discount) : 0.00;
        const creditLimitValue = credit_limit ? parseFloat(credit_limit) : 0.00;

        console.log('Inserting customer with values:', {
            name: nameValue,
            phone: phoneValue,
            email: emailValue,
            type: typeValue,
            country: countryValue,
            discount: discountValue,
            credit_limit: creditLimitValue
        });

        // Insert new customer
        const [result] = await connection.execute(`
            INSERT INTO customers (
                id, 
                shop_id, 
                name, 
                phone, 
                email, 
                address, 
                type, 
                city, 
                country, 
                notes, 
                reference, 
                discount, 
                credit_limit
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
        `, [
            customerIdBinary,
            shopIdBinary,
            nameValue,
            phoneValue,
            emailValue,
            addressValue,
            typeValue,
            cityValue,
            countryValue,
            notesValue,
            referenceValue,
            discountValue,
            creditLimitValue
        ]);

        console.log('Insert result:', result);
        connection.release();

        res.json({
            success: true,
            message: 'Customer added successfully',
            customerId: customerId
        });

    } catch (err) {
        console.error('=== ERROR ADDING CUSTOMER ===');
        console.error('Error name:', err.name);
        console.error('Error message:', err.message);
        console.error('Error code:', err.code);
        console.error('SQL message:', err.sqlMessage);
        
        if (connection) {
            connection.release();
        }
        
        let errorMessage = 'Failed to add customer';
        
        if (err.code === 'ER_DUP_ENTRY') {
            if (err.sqlMessage && err.sqlMessage.includes('phone')) {
                errorMessage = 'Customer with this phone number already exists';
            } else if (err.sqlMessage && err.sqlMessage.includes('email')) {
                errorMessage = 'Customer with this email already exists';
            } else {
                errorMessage = 'Customer with this information already exists';
            }
        } else if (err.code === 'ER_NO_REFERENCED_ROW_2') {
            errorMessage = 'Shop not found. Please make sure you are logged into a valid shop.';
        } else if (err.code === 'ER_BAD_NULL_ERROR') {
            errorMessage = `Required field cannot be null: ${err.sqlMessage}`;
        } else {
            errorMessage = `Database error: ${err.message}`;
        }

        res.status(500).json({
            success: false,
            message: errorMessage
        });
    }
});

// GET /customers/:id - Get customer details with ledger
router.get('/:id', getShopDetails, async (req, res) => {
    try {
        const customerId = req.params.id;
        console.log('Fetching customer details for ID:', customerId);

        // Get customer details
        const [customers] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(id) as id,
                name,
                phone,
                email,
                address,
                type,
                city,
                country,
                notes,
                discount,
                credit_limit,
                created_at,
                updated_at
            FROM customers 
            WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
        `, [customerId, req.shop.id]);

        if (customers.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }

        const customer = customers[0];

        // Get complete ledger (all bills with details)
        const [ledger] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(b.id) as bill_id,
                b.bill_number,
                b.total_amount,
                b.paid_amount,
                b.due_amount,
                b.payment_method,
                b.created_at,
                b.notes as bill_notes,
                (
                    SELECT JSON_ARRAYAGG(
                        JSON_OBJECT(
                            'product_name', p.name,
                            'quantity', bi.quantity,
                            'unit_price', bi.unit_price,
                            'total_price', bi.total_price
                        )
                    )
                    FROM bill_items bi
                    LEFT JOIN products p ON bi.product_id = p.id
                    WHERE bi.bill_id = b.id
                ) as items
            FROM bills b
            WHERE b.shop_id = UUID_TO_BIN(?) AND b.customer_id = UUID_TO_BIN(?)
            ORDER BY b.created_at DESC
        `, [req.shop.id, customerId]);

        // Get purchase statistics
        const [statsResult] = await pool.execute(`
            SELECT 
                COUNT(*) as total_purchases,
                COALESCE(SUM(total_amount), 0) as total_spent,
                COALESCE(AVG(total_amount), 0) as avg_purchase,
                COALESCE(MIN(total_amount), 0) as min_purchase,
                COALESCE(MAX(total_amount), 0) as max_purchase,
                COALESCE(SUM(due_amount), 0) as total_due,
                DATE(MIN(created_at)) as first_purchase,
                DATE(MAX(created_at)) as last_purchase
            FROM bills 
            WHERE shop_id = UUID_TO_BIN(?) AND customer_id = UUID_TO_BIN(?)
        `, [req.shop.id, customerId]);

        const purchaseStats = statsResult[0] || {
            total_purchases: 0,
            total_spent: 0,
            avg_purchase: 0,
            min_purchase: 0,
            max_purchase: 0,
            total_due: 0,
            first_purchase: null,
            last_purchase: null
        };

        // Get favorite products
        const [favoriteProducts] = await pool.execute(`
            SELECT 
                p.name,
                COUNT(bi.id) as purchase_count,
                SUM(bi.quantity) as total_quantity,
                COALESCE(SUM(bi.total_price), 0) as total_spent
            FROM bill_items bi
            JOIN products p ON bi.product_id = p.id
            JOIN bills b ON bi.bill_id = b.id
            WHERE b.shop_id = UUID_TO_BIN(?) AND b.customer_id = UUID_TO_BIN(?)
            GROUP BY p.id
            ORDER BY total_spent DESC
            LIMIT 10
        `, [req.shop.id, customerId]);

        // Parse items JSON for each bill
        const formattedLedger = ledger.map(bill => ({
            ...bill,
            items: bill.items ? JSON.parse(bill.items) : []
        }));

        res.json({
            success: true,
            customer: customer,
            ledger: formattedLedger,
            purchaseStats: purchaseStats,
            favoriteProducts: favoriteProducts
        });

    } catch (err) {
        console.error('Error loading customer details:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load customer details'
        });
    }
});

// PUT /customers/:id - Update customer
router.put('/:id', getShopDetails, async (req, res) => {
    let connection;
    try {
        const customerId = req.params.id;
        const { name, phone, email, address, type, city, country, notes, discount, credit_limit } = req.body;

        console.log('Updating customer:', customerId, req.body);

        // Validate required fields
        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Name is required'
            });
        }

        connection = await pool.getConnection();

        // Check if customer exists
        const [existingCustomer] = await connection.execute(`
            SELECT id FROM customers 
            WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
        `, [customerId, req.shop.id]);

        if (existingCustomer.length === 0) {
            connection.release();
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }

        // Handle phone if provided
        let cleanPhone = null;
        if (phone && phone.trim()) {
            cleanPhone = phone.replace(/\D/g, '');
            
            if (cleanPhone.length > 0 && cleanPhone.length !== 11) {
                connection.release();
                return res.status(400).json({
                    success: false,
                    message: 'Phone number must be 11 digits'
                });
            }

            // Check if new phone already exists for another customer
            const [duplicatePhone] = await connection.execute(`
                SELECT id FROM customers 
                WHERE shop_id = UUID_TO_BIN(?) AND phone = ? AND id != UUID_TO_BIN(?)
            `, [req.shop.id, cleanPhone, customerId]);

            if (duplicatePhone.length > 0) {
                connection.release();
                return res.status(400).json({
                    success: false,
                    message: 'Phone number already exists for another customer'
                });
            }
        }

        // Update customer
        await connection.execute(`
            UPDATE customers 
            SET name = ?, 
                phone = ?, 
                email = ?, 
                address = ?, 
                type = ?,
                city = ?,
                country = ?,
                notes = ?,
                discount = ?,
                credit_limit = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
        `, [
            name.trim(), 
            cleanPhone, 
            email && email.trim() ? email.trim() : null, 
            address && address.trim() ? address.trim() : null,
            type || 'regular',
            city && city.trim() ? city.trim() : null,
            country && country.trim() ? country.trim() : 'Pakistan',
            notes && notes.trim() ? notes.trim() : null,
            discount ? parseFloat(discount) : 0,
            credit_limit ? parseFloat(credit_limit) : 0,
            customerId, 
            req.shop.id
        ]);

        connection.release();

        res.json({
            success: true,
            message: 'Customer updated successfully'
        });

    } catch (err) {
        console.error('Error updating customer:', err);
        if (connection) connection.release();
        res.status(500).json({
            success: false,
            message: 'Failed to update customer'
        });
    }
});

// DELETE /customers/:id - Delete customer
router.delete('/:id', getShopDetails, async (req, res) => {
    let connection;
    try {
        const customerId = req.params.id;
        
        connection = await pool.getConnection();

        // Check if customer has any bills
        const [billCount] = await connection.execute(`
            SELECT COUNT(*) as count 
            FROM bills 
            WHERE customer_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
        `, [customerId, req.shop.id]);

        if (billCount[0].count > 0) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Cannot delete customer with purchase history'
            });
        }

        // Delete customer
        const [result] = await connection.execute(`
            DELETE FROM customers 
            WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
        `, [customerId, req.shop.id]);

        connection.release();

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }

        res.json({
            success: true,
            message: 'Customer deleted successfully'
        });

    } catch (err) {
        console.error('Error deleting customer:', err);
        if (connection) connection.release();
        res.status(500).json({
            success: false,
            message: 'Failed to delete customer'
        });
    }
});

// GET /customers/search/:query - Search customers
router.get('/search/:query', getShopDetails, async (req, res) => {
    try {
        const searchQuery = `%${req.params.query}%`;

        const [customers] = await pool.execute(`
            SELECT 
                BIN_TO_UUID(id) as id,
                name,
                phone,
                email,
                address
            FROM customers 
            WHERE shop_id = UUID_TO_BIN(?)
            AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)
            ORDER BY name
            LIMIT 20
        `, [req.shop.id, searchQuery, searchQuery, searchQuery]);

        res.json({
            success: true,
            customers: customers
        });

    } catch (err) {
        console.error('Error searching customers:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to search customers'
        });
    }
});

// Debug endpoint to check database
router.get('/debug/check', getShopDetails, async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Test connection
        const [testResult] = await connection.execute('SELECT 1 as test');
        
        // Check if shop exists
        const [shopCheck] = await connection.execute(
            'SELECT BIN_TO_UUID(id) as id FROM shops WHERE id = UUID_TO_BIN(?)',
            [req.shop.id]
        );
        
        // Check customers table structure
        const [columns] = await connection.execute('DESCRIBE customers');
        
        connection.release();
        
        res.json({
            success: true,
            message: 'Database is working correctly',
            shop: {
                id: req.shop.id,
                exists: shopCheck.length > 0,
                name: req.shop.name
            },
            test: testResult,
            columns: columns.map(c => c.Field)
        });
        
    } catch (err) {
        console.error('Debug error:', err);
        if (connection) connection.release();
        res.status(500).json({
            success: false,
            message: 'Debug check failed',
            error: err.message,
            sqlMessage: err.sqlMessage
        });
    }
});

module.exports = router;