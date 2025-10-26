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

// GET suppliers listing
router.get('/', getShopPrefix, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;

        // Get suppliers with product counts
        const [suppliers] = await pool.execute(
            `SELECT 
                s.*,
                COUNT(sp.product_id) as product_count,
                COUNT(CASE WHEN p.status = 'active' THEN 1 END) as active_product_count
             FROM ${req.tablePrefix}suppliers s
             LEFT JOIN ${req.tablePrefix}supplier_products sp ON s.id = sp.supplier_id
             LEFT JOIN ${req.tablePrefix}products p ON sp.product_id = p.id
             GROUP BY s.id
             ORDER BY s.created_at DESC 
             LIMIT ? OFFSET ?`,
            [limit, offset]
        );

        // Get total count for pagination
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM ${req.tablePrefix}suppliers`
        );
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Get distinct cities for filter dropdown
        const [citiesResult] = await pool.execute(
            `SELECT DISTINCT city FROM ${req.tablePrefix}suppliers WHERE city IS NOT NULL AND city != ''`
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
router.post('/', getShopPrefix, async (req, res) => {
    try {
        const {
            name, contact_person, email, phone, address, city, country,
            tax_number, payment_terms, account_number, bank_name, notes
        } = req.body;

        // Validate required fields
        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'Supplier name is required'
            });
        }

        await pool.execute(
            `INSERT INTO ${req.tablePrefix}suppliers 
             (name, contact_person, email, phone, address, city, country,
              tax_number, payment_terms, account_number, bank_name, notes, created_by, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
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
                req.session.userId
            ]
        );

        res.json({ success: true, message: 'Supplier added successfully' });
    } catch (err) {
        console.error('Error creating supplier:', err);
        res.status(500).json({
            success: false,
            message: 'Error creating supplier'
        });
    }
});

// GET supplier for editing
router.get('/:id/edit', getShopPrefix, async (req, res) => {
    try {
        const supplierId = req.params.id;

        const [suppliers] = await pool.execute(
            `SELECT * FROM ${req.tablePrefix}suppliers WHERE id = ?`,
            [supplierId]
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
router.put('/:id', getShopPrefix, async (req, res) => {
    try {
        const {
            name, contact_person, email, phone, address, city, country,
            tax_number, payment_terms, account_number, bank_name, notes
        } = req.body;

        await pool.execute(
            `UPDATE ${req.tablePrefix}suppliers 
             SET name = ?, contact_person = ?, email = ?, phone = ?, address = ?, 
                 city = ?, country = ?, tax_number = ?, payment_terms = ?, 
                 account_number = ?, bank_name = ?, notes = ?, updated_at = NOW()
             WHERE id = ?`,
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
                req.params.id
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
router.post('/:id/toggle-status', getShopPrefix, async (req, res) => {
    try {
        await pool.execute(
            `UPDATE ${req.tablePrefix}suppliers 
             SET status = CASE WHEN status = 'active' THEN 'inactive' ELSE 'active' END 
             WHERE id = ?`,
            [req.params.id]
        );

        res.json({ success: true, message: 'Supplier status updated' });
    } catch (err) {
        console.error('Error toggling supplier status:', err);
        res.status(500).json({ success: false, message: 'Error toggling supplier status' });
    }
});

// GET supplier products
router.get('/:id/products', getShopPrefix, async (req, res) => {
    try {
        const supplierId = req.params.id;

        const [products] = await pool.execute(
            `SELECT 
                sp.*,
                p.name as product_name,
                p.sku as product_sku,
                p.brand as product_brand,
                p.category as product_category,
                p.image as product_image,
                CAST(p.selling_price AS DECIMAL(10,2)) as selling_price
             FROM ${req.tablePrefix}supplier_products sp
             JOIN ${req.tablePrefix}products p ON sp.product_id = p.id
             WHERE sp.supplier_id = ?
             ORDER BY p.name ASC`,
            [supplierId]
        );

        // Get all available products for adding to supplier
        const [availableProducts] = await pool.execute(
            `SELECT id, name, sku, brand, category 
             FROM ${req.tablePrefix}products 
             WHERE status = 'active' 
             AND id NOT IN (
                 SELECT product_id FROM ${req.tablePrefix}supplier_products WHERE supplier_id = ?
             )
             ORDER BY name ASC`,
            [supplierId]
        );

        res.json({
            success: true,
            products,
            availableProducts
        });
    } catch (err) {
        console.error('Error fetching supplier products:', err);
        res.status(500).json({
            success: false,
            message: 'Error loading supplier products'
        });
    }
});

// POST add product to supplier
router.post('/:id/products', getShopPrefix, async (req, res) => {
    try {
        const { product_id, supplier_sku, supplier_price, min_order_quantity, lead_time_days } = req.body;
        const supplierId = req.params.id;

        await pool.execute(
            `INSERT INTO ${req.tablePrefix}supplier_products 
             (supplier_id, product_id, supplier_sku, supplier_price, min_order_quantity, lead_time_days)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                supplierId,
                product_id,
                supplier_sku || null,
                supplier_price ? parseFloat(supplier_price) : null,
                min_order_quantity ? parseInt(min_order_quantity) : 1,
                lead_time_days ? parseInt(lead_time_days) : null
            ]
        );

        res.json({ success: true, message: 'Product added to supplier successfully' });
    } catch (err) {
        console.error('Error adding product to supplier:', err);
        res.status(500).json({
            success: false,
            message: 'Error adding product to supplier'
        });
    }
});

// PUT update supplier product
router.put('/:id/products/:productId', getShopPrefix, async (req, res) => {
    try {
        const { supplier_sku, supplier_price, min_order_quantity, lead_time_days } = req.body;
        const supplierId = req.params.id;
        const productId = req.params.productId;

        await pool.execute(
            `UPDATE ${req.tablePrefix}supplier_products 
             SET supplier_sku = ?, supplier_price = ?, min_order_quantity = ?, lead_time_days = ?, updated_at = NOW()
             WHERE supplier_id = ? AND product_id = ?`,
            [
                supplier_sku || null,
                supplier_price ? parseFloat(supplier_price) : null,
                min_order_quantity ? parseInt(min_order_quantity) : 1,
                lead_time_days ? parseInt(lead_time_days) : null,
                supplierId,
                productId
            ]
        );

        res.json({ success: true, message: 'Supplier product updated successfully' });
    } catch (err) {
        console.error('Error updating supplier product:', err);
        res.status(500).json({
            success: false,
            message: 'Error updating supplier product'
        });
    }
});

// DELETE remove product from supplier
router.delete('/:id/products/:productId', getShopPrefix, async (req, res) => {
    try {
        const supplierId = req.params.id;
        const productId = req.params.productId;

        await pool.execute(
            `DELETE FROM ${req.tablePrefix}supplier_products 
             WHERE supplier_id = ? AND product_id = ?`,
            [supplierId, productId]
        );

        res.json({ success: true, message: 'Product removed from supplier successfully' });
    } catch (err) {
        console.error('Error removing product from supplier:', err);
        res.status(500).json({
            success: false,
            message: 'Error removing product from supplier'
        });
    }
});

module.exports = router;