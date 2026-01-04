const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for product images
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

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

// GET products listing
router.get('/', getShopInfo, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;

        // Get products with stock info from inventory table
        const [products] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(p.id) as id,
                p.name, 
                p.brand, 
                p.category, 
                p.size, 
                p.sku, 
                p.barcode,
                COALESCE(i.current_quantity, 0) as total_stock,
                COALESCE(i.avg_cost, 0) as avg_cost,
                COUNT(DISTINCT ing.raw_material_id) as ingredient_count,
                p.created_at,
                p.status
             FROM products p
             LEFT JOIN inventory i ON p.id = i.product_id
             LEFT JOIN ingredients ing ON p.id = ing.main_product_id
             WHERE p.shop_id = UUID_TO_BIN(?)
             GROUP BY p.id, p.name, p.brand, p.category, p.size, 
                      p.sku, p.barcode, p.created_at, p.status,
                      i.current_quantity, i.avg_cost
             ORDER BY p.created_at DESC 
             LIMIT ? OFFSET ?`,
            [req.shopId, limit, offset]
        );

        // Get total count for pagination
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM products WHERE shop_id = UUID_TO_BIN(?)`,
            [req.shopId]
        );
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Get distinct categories for filter dropdown
        const [categoriesResult] = await pool.execute(
            `SELECT DISTINCT category FROM products 
             WHERE shop_id = UUID_TO_BIN(?) AND category IS NOT NULL`,
            [req.shopId]
        );
        const categories = categoriesResult.map(item => item.category);

        // Get all raw materials for ingredient selection
        const [rawMaterials] = await pool.execute(
            `SELECT BIN_TO_UUID(id) as id, name, sku, current_stock, unit_of_measure
             FROM raw_materials 
             WHERE shop_id = UUID_TO_BIN(?) AND is_active = true
             ORDER BY name ASC`,
            [req.shopId]
        );

        res.render('products/index', {
            title: 'Products',
            products: products || [],
            rawMaterials: rawMaterials || [],
            categories: categories || [],
            currentPage: page,
            totalPages,
            shop: req.shop
        });
    } catch (err) {
        console.error('Error fetching products:', err);
        res.status(500).render('error', {
            title: 'Error',
            message: 'An error occurred while fetching products: ' + err.message
        });
    }
});

// POST create new product (without stock)
router.post('/', getShopInfo, async (req, res) => {
    try {
        const {
            name, brand, category, size, sku, barcode,
            ingredients, status = 'active'
        } = req.body;

        // Validate required fields
        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'Product name is required'
            });
        }

        // Start transaction
        await pool.query('START TRANSACTION');

        try {
            // Insert product
            const [result] = await pool.execute(
                `INSERT INTO products 
                 (id, shop_id, name, brand, category, size, sku, barcode, status)
                 VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, ?)`,
                [
                    req.shopId,
                    name,
                    brand || null,
                    category || null,
                    size || null,
                    sku || null,
                    barcode || null,
                    status
                ]
            );

            // Get the inserted product ID
            const [newProduct] = await pool.execute(
                'SELECT BIN_TO_UUID(id) as id FROM products WHERE name = ? AND shop_id = UUID_TO_BIN(?) ORDER BY created_at DESC LIMIT 1',
                [name, req.shopId]
            );
            
            const productId = newProduct[0].id;

            // Insert ingredients if provided
            if (ingredients && ingredients !== '[]') {
                try {
                    const ingredientList = JSON.parse(ingredients);
                    for (const ingredient of ingredientList) {
                        await pool.execute(
                            `INSERT INTO ingredients 
                             (id, shop_id, main_product_id, raw_material_id, quantity_required, unit)
                             VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?)`,
                            [
                                req.shopId,
                                productId,
                                ingredient.raw_material_id,
                                parseFloat(ingredient.quantity) || 0,
                                ingredient.unit || 'pcs'
                            ]
                        );
                    }
                } catch (parseError) {
                    console.error('Error parsing ingredients:', parseError);
                }
            }

            // Initialize inventory with 0 stock
            await pool.execute(
                `INSERT INTO inventory (id, shop_id, product_id, current_quantity, avg_cost)
                 VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), 0, 0)`,
                [req.shopId, productId]
            );

            // Commit transaction
            await pool.query('COMMIT');

            res.json({ 
                success: true, 
                message: 'Product added successfully',
                productId: productId
            });
        } catch (error) {
            // Rollback on error
            await pool.query('ROLLBACK');
            throw error;
        }
    } catch (err) {
        console.error('Error creating product:', err);
        res.status(500).json({
            success: false,
            message: 'Error creating product: ' + err.message
        });
    }
});

// GET product details for editing
router.get('/:id/edit', getShopInfo, async (req, res) => {
    try {
        const productId = req.params.id;
        
        // Get product details
        const [products] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(p.id) as id,
                p.name, p.brand, p.category, p.size, p.sku, p.barcode,
                p.status, p.created_at
             FROM products p
             WHERE p.id = UUID_TO_BIN(?) AND p.shop_id = UUID_TO_BIN(?)`,
            [productId, req.shopId]
        );
        
        if (products.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found' 
            });
        }

        // Get inventory info
        const [inventoryInfo] = await pool.execute(
            `SELECT current_quantity, avg_cost
             FROM inventory 
             WHERE product_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [productId, req.shopId]
        );

        // Get product ingredients
        const [ingredients] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(i.raw_material_id) as raw_material_id,
                rm.name as raw_material_name,
                rm.sku as raw_material_sku,
                rm.current_stock,
                rm.unit_of_measure,
                i.quantity_required,
                i.unit
             FROM ingredients i
             JOIN raw_materials rm ON i.raw_material_id = rm.id
             WHERE i.main_product_id = UUID_TO_BIN(?) AND i.shop_id = UUID_TO_BIN(?)`,
            [productId, req.shopId]
        );

        // Get all raw materials for dropdown
        const [rawMaterials] = await pool.execute(
            `SELECT BIN_TO_UUID(id) as id, name, sku, current_stock, unit_of_measure
             FROM raw_materials 
             WHERE shop_id = UUID_TO_BIN(?) AND is_active = true
             ORDER BY name ASC`,
            [req.shopId]
        );
        
        res.json({
            success: true,
            product: {
                ...products[0],
                current_quantity: inventoryInfo[0]?.current_quantity || 0,
                avg_cost: inventoryInfo[0]?.avg_cost || 0
            },
            ingredients: ingredients || [],
            rawMaterials: rawMaterials || []
        });
    } catch (err) {
        console.error('Error fetching product for edit:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error loading product details: ' + err.message
        });
    }
});

// PUT update product
router.put('/:id', getShopInfo, async (req, res) => {
    try {
        const {
            name, brand, category, size, sku, barcode,
            ingredients, status
        } = req.body;
        
        const productId = req.params.id;
        
        // Check if product exists
        const [products] = await pool.execute(
            `SELECT id FROM products WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [productId, req.shopId]
        );
        
        if (products.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found' 
            });
        }
        
        // Start transaction
        await pool.query('START TRANSACTION');

        try {
            // Update product
            await pool.execute(
                `UPDATE products 
                 SET name = ?, brand = ?, category = ?, size = ?, sku = ?, 
                     barcode = ?, status = ?, updated_at = NOW()
                 WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
                [
                    name, 
                    brand || null, 
                    category || null, 
                    size || null, 
                    sku || null, 
                    barcode || null,
                    status || 'active',
                    productId,
                    req.shopId
                ]
            );

            // Delete existing ingredients
            await pool.execute(
                `DELETE FROM ingredients 
                 WHERE main_product_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
                [productId, req.shopId]
            );

            // Insert new ingredients if provided
            if (ingredients && ingredients !== '[]') {
                try {
                    const ingredientList = JSON.parse(ingredients);
                    for (const ingredient of ingredientList) {
                        await pool.execute(
                            `INSERT INTO ingredients 
                             (id, shop_id, main_product_id, raw_material_id, quantity_required, unit)
                             VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?)`,
                            [
                                req.shopId,
                                productId,
                                ingredient.raw_material_id,
                                parseFloat(ingredient.quantity) || 0,
                                ingredient.unit || 'pcs'
                            ]
                        );
                    }
                } catch (parseError) {
                    console.error('Error parsing ingredients:', parseError);
                }
            }

            // Commit transaction
            await pool.query('COMMIT');
            
            res.json({ 
                success: true, 
                message: 'Product updated successfully' 
            });
        } catch (error) {
            // Rollback on error
            await pool.query('ROLLBACK');
            throw error;
        }
    } catch (err) {
        console.error('Error updating product:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error updating product: ' + err.message
        });
    }
});

// POST add stock to product (batch operation)
router.post('/:id/stock', getShopInfo, async (req, res) => {
    try {
        const { stock_entries } = req.body;
        const productId = req.params.id;

        if (!stock_entries || !Array.isArray(stock_entries) || stock_entries.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'At least one stock entry is required'
            });
        }

        // Check if product exists
        const [products] = await pool.execute(
            `SELECT id FROM products WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [productId, req.shopId]
        );
        
        if (products.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found' 
            });
        }

        // Start transaction
        await pool.query('START TRANSACTION');

        try {
            let totalQuantity = 0;
            let totalValue = 0;
            const supplierTransactions = [];

            // Process each stock entry
            for (const entry of stock_entries) {
                const { batch_number, quantity, unit_price, expiry_date, supplier_id, notes } = entry;

                if (!quantity || !unit_price) {
                    throw new Error('Quantity and unit price are required for each entry');
                }

                const qty = parseFloat(quantity);
                const price = parseFloat(unit_price);
                const entryValue = qty * price;

                // Insert stock entry into stock_in table
                await pool.execute(
                    `INSERT INTO stock_in 
                     (id, shop_id, product_id, batch_number, quantity, unit_price, 
                      expiry_date, supplier_id, notes, received_by)
                     VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?, ?, 
                             ?, UUID_TO_BIN(?), ?, UUID_TO_BIN(?))`,
                    [
                        req.shopId,
                        productId,
                        batch_number || null,
                        qty,
                        price,
                        expiry_date || null,
                        supplier_id || null,
                        notes || null,
                        req.session.userId
                    ]
                );

                // Add to supplier transactions if supplier exists
                if (supplier_id) {
                    supplierTransactions.push({
                        supplier_id,
                        amount: entryValue,
                        description: `Stock purchase for ${entry.batch_number || 'N/A'}`
                    });
                }

                totalQuantity += qty;
                totalValue += entryValue;

                // Check and consume raw materials if ingredients exist
                const [ingredients] = await pool.execute(
                    `SELECT 
                        BIN_TO_UUID(i.raw_material_id) as raw_material_id,
                        rm.name,
                        rm.current_stock,
                        i.quantity_required,
                        i.unit
                     FROM ingredients i
                     JOIN raw_materials rm ON i.raw_material_id = rm.id
                     WHERE i.main_product_id = UUID_TO_BIN(?) AND i.shop_id = UUID_TO_BIN(?)`,
                    [productId, req.shopId]
                );

                // Update raw material stock if ingredients exist
                if (ingredients && ingredients.length > 0) {
                    for (const ingredient of ingredients) {
                        const requiredQuantity = parseFloat(ingredient.quantity_required) * qty;
                        
                        if (ingredient.current_stock < requiredQuantity) {
                            throw new Error(`Insufficient raw material: ${ingredient.name}. Required: ${requiredQuantity}, Available: ${ingredient.current_stock}`);
                        }

                        // Deduct raw material stock
                        await pool.execute(
                            `UPDATE raw_materials 
                             SET current_stock = current_stock - ?
                             WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
                            [requiredQuantity, ingredient.raw_material_id, req.shopId]
                        );

                        // Record raw material movement
                        await pool.execute(
                            `INSERT INTO raw_material_stock_movements 
                             (id, shop_id, raw_material_id, batch_number, movement_type, quantity, 
                              unit_cost, reference_type, reference_id, movement_date, created_by)
                             VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, 'out', ?, 
                                     (SELECT cost_price FROM raw_materials WHERE id = UUID_TO_BIN(?)),
                                     'production', UUID_TO_BIN(?), CURDATE(), UUID_TO_BIN(?))`,
                            [
                                req.shopId,
                                ingredient.raw_material_id,
                                batch_number || `PROD-${productId.slice(0, 8)}`,
                                requiredQuantity,
                                ingredient.raw_material_id,
                                productId,
                                req.session.userId
                            ]
                        );
                    }
                }
            }

            // Update supplier balances for all transactions
            for (const transaction of supplierTransactions) {
                // Record supplier transaction
                await pool.execute(
                    `INSERT INTO supplier_transactions 
                     (id, shop_id, supplier_id, type, amount, description)
                     VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), 'debit', ?, ?)`,
                    [req.shopId, transaction.supplier_id, transaction.amount, transaction.description]
                );

                // Update supplier balance
                const [balanceCheck] = await pool.execute(
                    `SELECT id FROM supplier_balance 
                     WHERE shop_id = UUID_TO_BIN(?) AND supplier_id = UUID_TO_BIN(?)`,
                    [req.shopId, transaction.supplier_id]
                );

                if (balanceCheck.length === 0) {
                    // Create new balance record
                    await pool.execute(
                        `INSERT INTO supplier_balance (id, shop_id, supplier_id, total_debit)
                         VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), ?)`,
                        [req.shopId, transaction.supplier_id, transaction.amount]
                    );
                } else {
                    // Update existing balance
                    await pool.execute(
                        `UPDATE supplier_balance 
                         SET total_debit = total_debit + ?, 
                             updated_at = NOW()
                         WHERE shop_id = UUID_TO_BIN(?) AND supplier_id = UUID_TO_BIN(?)`,
                        [transaction.amount, req.shopId, transaction.supplier_id]
                    );
                }
            }

            // Update inventory
            const [inventoryCheck] = await pool.execute(
                `SELECT current_quantity, avg_cost FROM inventory 
                 WHERE product_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
                [productId, req.shopId]
            );

            if (inventoryCheck.length === 0) {
                // Insert new inventory record
                await pool.execute(
                    `INSERT INTO inventory (id, shop_id, product_id, current_quantity, avg_cost)
                     VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?)`,
                    [req.shopId, productId, totalQuantity, totalValue / totalQuantity]
                );
            } else {
                const currentQty = parseFloat(inventoryCheck[0].current_quantity);
                const currentAvg = parseFloat(inventoryCheck[0].avg_cost);
                const newAvg = ((currentQty * currentAvg) + totalValue) / (currentQty + totalQuantity);

                await pool.execute(
                    `UPDATE inventory 
                     SET current_quantity = current_quantity + ?,
                         avg_cost = ?,
                         updated_at = NOW()
                     WHERE product_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
                    [totalQuantity, newAvg, productId, req.shopId]
                );
            }

            // Commit transaction
            await pool.query('COMMIT');

            res.json({ 
                success: true, 
                message: `${stock_entries.length} stock entries added successfully` 
            });
        } catch (error) {
            // Rollback on error
            await pool.query('ROLLBACK');
            throw error;
        }
    } catch (err) {
        console.error('Error adding stock:', err);
        res.status(500).json({ 
            success: false, 
            message: err.message || 'Error adding stock' 
        });
    }
});

// GET stock ledger for a product
router.get('/:id/ledger', getShopInfo, async (req, res) => {
    try {
        const productId = req.params.id;
        
        // Get product info
        const [products] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(p.id) as id,
                p.name,
                p.brand,
                p.category,
                p.size,
                p.sku,
                COALESCE(i.current_quantity, 0) as total_stock
             FROM products p
             LEFT JOIN inventory i ON p.id = i.product_id
             WHERE p.id = UUID_TO_BIN(?) AND p.shop_id = UUID_TO_BIN(?)`,
            [productId, req.shopId]
        );

        if (products.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found' 
            });
        }

        // Get stock ledger entries from stock_in table
        const [ledger] = await pool.execute(
            `SELECT 
                si.id,
                si.batch_number,
                si.quantity,
                CAST(si.unit_price AS DECIMAL(10,2)) as unit_price,
                CAST((si.quantity * si.unit_price) AS DECIMAL(12,2)) as total_value,
                si.expiry_date,
                s.name as supplier_name,
                u.name as received_by,
                si.notes,
                si.created_at as date_added
             FROM stock_in si
             LEFT JOIN suppliers s ON si.supplier_id = s.id
             LEFT JOIN users u ON si.received_by = u.id
             WHERE si.product_id = UUID_TO_BIN(?) AND si.shop_id = UUID_TO_BIN(?)
             ORDER BY si.created_at DESC`,
            [productId, req.shopId]
        );

        res.json({
            success: true,
            product: products[0],
            ledger: ledger || [],
            totalEntries: ledger.length,
            shop: req.shop
        });
    } catch (err) {
        console.error('Error fetching stock ledger:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error loading stock ledger' 
        });
    }
});

// DELETE stock entry
router.delete('/stock/:stockId', getShopInfo, async (req, res) => {
    try {
        const stockId = req.params.stockId;

        // Start transaction
        await pool.query('START TRANSACTION');

        try {
            // Get stock entry details
            const [stockEntries] = await pool.execute(
                `SELECT 
                    BIN_TO_UUID(product_id) as product_id,
                    quantity,
                    unit_price,
                    supplier_id
                 FROM stock_in 
                 WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
                [stockId, req.shopId]
            );

            if (stockEntries.length === 0) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Stock entry not found' 
                });
            }

            const stockEntry = stockEntries[0];
            const totalValue = parseFloat(stockEntry.quantity) * parseFloat(stockEntry.unit_price);

            // Delete stock entry
            await pool.execute(
                `DELETE FROM stock_in 
                 WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
                [stockId, req.shopId]
            );

            // Update inventory
            await pool.execute(
                `UPDATE inventory 
                 SET current_quantity = current_quantity - ?,
                     updated_at = NOW()
                 WHERE product_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
                [stockEntry.quantity, stockEntry.product_id, req.shopId]
            );

            // Update supplier balance if supplier exists
            if (stockEntry.supplier_id) {
                await pool.execute(
                    `UPDATE supplier_balance 
                     SET total_debit = total_debit - ?,
                         updated_at = NOW()
                     WHERE supplier_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
                    [totalValue, stockEntry.supplier_id, req.shopId]
                );

                // Add reversal transaction
                await pool.execute(
                    `INSERT INTO supplier_transactions 
                     (id, shop_id, supplier_id, type, amount, description)
                     VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), 'credit', ?, 'Stock entry deletion reversal')`,
                    [req.shopId, stockEntry.supplier_id, totalValue]
                );
            }

            // Commit transaction
            await pool.query('COMMIT');

            res.json({ 
                success: true, 
                message: 'Stock entry deleted successfully' 
            });
        } catch (error) {
            // Rollback on error
            await pool.query('ROLLBACK');
            throw error;
        }
    } catch (err) {
        console.error('Error deleting stock entry:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error deleting stock entry' 
        });
    }
});

// GET product statistics
router.get('/stats', getShopInfo, async (req, res) => {
    try {
        // Get total products count
        const [productsCount] = await pool.execute(
            `SELECT COUNT(*) as total FROM products 
             WHERE shop_id = UUID_TO_BIN(?) AND status = 'active'`,
            [req.shopId]
        );
        
        // Get total stock quantity and value from inventory
        const [stockResult] = await pool.execute(
            `SELECT 
                COALESCE(SUM(current_quantity), 0) as total_quantity,
                COALESCE(SUM(current_quantity * avg_cost), 0) as total_value
             FROM inventory i
             JOIN products p ON i.product_id = p.id
             WHERE p.shop_id = UUID_TO_BIN(?) AND p.status = 'active'`,
            [req.shopId]
        );
        
        // Get products with ingredients
        const [withIngredients] = await pool.execute(
            `SELECT COUNT(DISTINCT p.id) as total
             FROM products p
             JOIN ingredients i ON p.id = i.main_product_id
             WHERE p.shop_id = UUID_TO_BIN(?) AND p.status = 'active'`,
            [req.shopId]
        );
        
        // Get low stock products
        const [lowStock] = await pool.execute(
            `SELECT COUNT(*) as total
             FROM inventory i
             JOIN products p ON i.product_id = p.id
             WHERE p.shop_id = UUID_TO_BIN(?) 
               AND p.status = 'active'
               AND i.current_quantity <= 5`, // Example: low stock threshold
            [req.shopId]
        );
        
        res.json({
            success: true,
            stats: {
                totalProducts: productsCount[0].total || 0,
                totalStock: stockResult[0].total_quantity || 0,
                totalValue: '₨' + (stockResult[0].total_value || 0).toLocaleString('en-IN'),
                withIngredients: withIngredients[0].total || 0,
                lowStockCount: lowStock[0].total || 0
            }
        });
    } catch (err) {
        console.error('Error fetching product stats:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching product statistics'
        });
    }
});

// GET suppliers for dropdown
router.get('/suppliers/list', getShopInfo, async (req, res) => {
    try {
        const [suppliers] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(id) as id,
                name, 
                contact_person,
                phone
             FROM suppliers 
             WHERE shop_id = UUID_TO_BIN(?) AND status = 'active' 
             ORDER BY name ASC`,
            [req.shopId]
        );

        res.json({
            success: true,
            suppliers: suppliers || []
        });
    } catch (err) {
        console.error('Error fetching suppliers:', err);
        res.status(500).json({
            success: false,
            message: 'Error loading suppliers'
        });
    }
});

// POST toggle product status
router.post('/:id/toggle-status', getShopInfo, async (req, res) => {
    try {
        const productId = req.params.id;

        // Get current status
        const [products] = await pool.execute(
            `SELECT status FROM products 
             WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [productId, req.shopId]
        );

        if (products.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found' 
            });
        }

        const newStatus = products[0].status === 'active' ? 'inactive' : 'active';

        // Update status
        await pool.execute(
            `UPDATE products 
             SET status = ?, updated_at = NOW()
             WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [newStatus, productId, req.shopId]
        );

        res.json({ 
            success: true, 
            message: `Product ${newStatus === 'active' ? 'activated' : 'deactivated'} successfully`,
            newStatus: newStatus
        });
    } catch (err) {
        console.error('Error toggling product status:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error updating product status' 
        });
    }
});

// GET bulk stock addition page
router.get('/stock/add', getShopInfo, async (req, res) => {
    try {
        // Get all active products
        const [products] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(p.id) as id,
                p.name,
                p.brand,
                p.category,
                p.sku,
                COALESCE(i.current_quantity, 0) as current_stock
             FROM products p
             LEFT JOIN inventory i ON p.id = i.product_id
             WHERE p.shop_id = UUID_TO_BIN(?) AND p.status = 'active'
             ORDER BY p.name ASC`,
            [req.shopId]
        );

        // Get all active suppliers
        const [suppliers] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(id) as id,
                name,
                contact_person,
                phone
             FROM suppliers 
             WHERE shop_id = UUID_TO_BIN(?) AND status = 'active'
             ORDER BY name ASC`,
            [req.shopId]
        );

        res.render('products/add-stock', {
            title: 'Add Stock',
            products: products || [],
            suppliers: suppliers || [],
            shop: req.shop
        });
    } catch (err) {
        console.error('Error loading stock addition page:', err);
        res.status(500).render('error', {
            title: 'Error',
            message: 'Error loading stock addition page'
        });
    }
});

// POST bulk stock addition with buying prices and supplier transactions
// router.post('/stock/bulk', getShopInfo, async (req, res) => {
//     try {
//         const { 
//             stock_entries, 
//             supplier_id, 
//             batch_number, 
//             transaction_type,
//             payment_amount,
//             total_buying_value,
//             total_selling_value,
//             notes 
//         } = req.body;

//         if (!stock_entries || !Array.isArray(stock_entries) || stock_entries.length === 0) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Please add at least one product with quantity'
//             });
//         }

//         if (!supplier_id) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Please select a supplier'
//             });
//         }

//         let totalBuyingValue = 0;
//         const results = [];

//         // Start transaction
//         await pool.query('START TRANSACTION');

//         try {
//             // Process each stock entry
//             for (const entry of stock_entries) {
//                 const { product_id, quantity, buying_price, selling_price } = entry;

//                 if (!product_id || !quantity || !buying_price || 
//                     parseFloat(quantity) <= 0 || parseFloat(buying_price) <= 0) {
//                     continue;
//                 }

//                 const qty = parseFloat(quantity);
//                 const buyingPrice = parseFloat(buying_price);
//                 const sellingPrice = parseFloat(selling_price) || buyingPrice * 1.3; // Default 30% markup
//                 const entryBuyingValue = qty * buyingPrice;
//                 const entrySellingValue = qty * sellingPrice;
//                 totalBuyingValue += entryBuyingValue;

//                 // Insert stock entry with buying price
//                 await pool.execute(
//                     `INSERT INTO stock_in 
//                      (id, shop_id, product_id, batch_number, quantity, 
//                       buying_price, selling_price, total_buying_value, total_selling_value,
//                       supplier_id, notes, received_by)
//                      VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?, 
//                              ?, ?, ?, ?, UUID_TO_BIN(?), ?, UUID_TO_BIN(?))`,
//                     [
//                         req.shopId,
//                         product_id,
//                         batch_number || null,
//                         qty,
//                         buyingPrice,
//                         sellingPrice,
//                         entryBuyingValue,
//                         entrySellingValue,
//                         supplier_id,
//                         notes || null,
//                         req.session.userId
//                     ]
//                 );

//                 // Update inventory with buying price for avg cost calculation
//                 const [inventoryCheck] = await pool.execute(
//                     `SELECT current_quantity, avg_cost 
//                      FROM inventory 
//                      WHERE product_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
//                     [product_id, req.shopId]
//                 );

//                 if (inventoryCheck.length === 0) {
//                     // Insert new inventory record with buying price as avg_cost
//                     await pool.execute(
//                         `INSERT INTO inventory (id, shop_id, product_id, current_quantity, avg_cost, selling_price)
//                          VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?, ?)`,
//                         [req.shopId, product_id, qty, buyingPrice, sellingPrice]
//                     );
//                 } else {
//                     const currentQty = parseFloat(inventoryCheck[0].current_quantity);
//                     const currentAvg = parseFloat(inventoryCheck[0].avg_cost);
//                     const newAvg = ((currentQty * currentAvg) + entryBuyingValue) / (currentQty + qty);

//                     // Update selling price if provided
//                     if (sellingPrice > 0) {
//                         await pool.execute(
//                             `UPDATE inventory 
//                              SET current_quantity = current_quantity + ?,
//                                  avg_cost = ?,
//                                  selling_price = ?,
//                                  updated_at = NOW()
//                              WHERE product_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
//                             [qty, newAvg, sellingPrice, product_id, req.shopId]
//                         );
//                     } else {
//                         await pool.execute(
//                             `UPDATE inventory 
//                              SET current_quantity = current_quantity + ?,
//                                  avg_cost = ?,
//                                  updated_at = NOW()
//                              WHERE product_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
//                             [qty, newAvg, product_id, req.shopId]
//                         );
//                     }
//                 }

//                 // Check and consume ingredients if needed
//                 const [ingredients] = await pool.execute(
//                     `SELECT 
//                         BIN_TO_UUID(i.raw_material_id) as raw_material_id,
//                         rm.name,
//                         rm.current_stock,
//                         i.quantity_required,
//                         i.unit
//                      FROM ingredients i
//                      JOIN raw_materials rm ON i.raw_material_id = rm.id
//                      WHERE i.main_product_id = UUID_TO_BIN(?) AND i.shop_id = UUID_TO_BIN(?)`,
//                     [product_id, req.shopId]
//                 );

//                 for (const ingredient of ingredients) {
//                     const requiredQuantity = parseFloat(ingredient.quantity_required) * qty;
                    
//                     if (ingredient.current_stock < requiredQuantity) {
//                         throw new Error(`Insufficient raw material: ${ingredient.name}. Required: ${requiredQuantity}, Available: ${ingredient.current_stock}`);
//                     }

//                     // Deduct raw material stock
//                     await pool.execute(
//                         `UPDATE raw_materials 
//                          SET current_stock = current_stock - ?
//                          WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
//                         [requiredQuantity, ingredient.raw_material_id, req.shopId]
//                     );

//                     // Record raw material movement
//                     await pool.execute(
//                         `INSERT INTO raw_material_stock_movements 
//                          (id, shop_id, raw_material_id, batch_number, movement_type, quantity, 
//                           unit_cost, reference_type, reference_id, movement_date, created_by)
//                          VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, 'out', ?, 
//                                  (SELECT cost_price FROM raw_materials WHERE id = UUID_TO_BIN(?)),
//                                  'production', UUID_TO_BIN(?), CURDATE(), UUID_TO_BIN(?))`,
//                         [
//                             req.shopId,
//                             ingredient.raw_material_id,
//                             batch_number || `PROD-${product_id.slice(0, 8)}`,
//                             requiredQuantity,
//                             ingredient.raw_material_id,
//                             product_id,
//                             req.session.userId
//                         ]
//                     );
//                 }

//                 // Get product info for response
//                 const [productInfo] = await pool.execute(
//                     `SELECT name FROM products WHERE id = UUID_TO_BIN(?)`,
//                     [product_id]
//                 );

//                 results.push({
//                     product_id,
//                     product_name: productInfo[0]?.name || 'Unknown',
//                     quantity: qty,
//                     buying_price: buyingPrice,
//                     selling_price: sellingPrice,
//                     buying_total: entryBuyingValue,
//                     selling_total: entrySellingValue
//                 });
//             }

//             // Handle supplier transactions based on transaction type
//             const paymentAmount = parseFloat(payment_amount) || 0;
//             const transactionAmount = totalBuyingValue;

//             if (transaction_type === 'credit') {
//                 // For credit purchase, add to supplier balance
//                 await recordSupplierTransaction(supplier_id, 'debit', transactionAmount, 
//                     `Credit purchase - Batch: ${batch_number || 'No batch'}`, req);
                
//             } else if (transaction_type === 'cash') {
//                 // For cash purchase, record full payment
//                 await recordSupplierTransaction(supplier_id, 'debit', transactionAmount, 
//                     `Cash purchase - Batch: ${batch_number || 'No batch'}`, req);
                
//                 // Record cash payment
//                 await recordSupplierTransaction(supplier_id, 'credit', paymentAmount, 
//                     `Cash payment for batch: ${batch_number || 'No batch'}`, req);
                
//             } else if (transaction_type === 'partial') {
//                 // For partial payment, record purchase and partial payment
//                 await recordSupplierTransaction(supplier_id, 'debit', transactionAmount, 
//                     `Purchase with partial payment - Batch: ${batch_number || 'No batch'}`, req);
                
//                 // Record partial payment
//                 await recordSupplierTransaction(supplier_id, 'credit', paymentAmount, 
//                     `Partial payment for batch: ${batch_number || 'No batch'}`, req);
//             }

//             // Get supplier info
//             const [supplierInfo] = await pool.execute(
//                 `SELECT name FROM suppliers WHERE id = UUID_TO_BIN(?)`,
//                 [supplier_id]
//             );

//             results.push({
//                 supplier: supplierInfo[0]?.name || 'Unknown',
//                 transaction_type: transaction_type,
//                 total_purchase: totalBuyingValue,
//                 payment_made: paymentAmount,
//                 balance_after: (await getSupplierBalance(supplier_id, req)).balance
//             });

//             // Commit transaction
//             await pool.query('COMMIT');

//             res.json({
//                 success: true,
//                 message: `Stock added successfully for ${results.length - 1} products`,
//                 results: results,
//                 total_buying_value: totalBuyingValue,
//                 total_selling_value: total_selling_value,
//                 batch_number: batch_number,
//                 receipt_id: Date.now().toString()
//             });

//         } catch (error) {
//             // Rollback on error
//             await pool.query('ROLLBACK');
//             throw error;
//         }
//     } catch (err) {
//         console.error('Error adding bulk stock:', err);
//         res.status(500).json({
//             success: false,
//             message: err.message || 'Error adding stock'
//         });
//     }
// });
// POST bulk stock addition with optional supplier
router.post('/stock/bulk', getShopInfo, async (req, res) => {
    try {
        const { 
            stock_entries, 
            supplier_id,  // Can be null
            batch_number, 
            transaction_type,
            payment_amount,
            total_buying_value,
            notes 
        } = req.body;

        if (!stock_entries || !Array.isArray(stock_entries) || stock_entries.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Please add at least one product with quantity'
            });
        }

        let totalBuyingValue = 0;
        const results = [];

        // Start transaction
        await pool.query('START TRANSACTION');

        try {
            // Process each stock entry
            for (const entry of stock_entries) {
                const { product_id, quantity, buying_price, selling_price } = entry;

                if (!product_id || !quantity || !buying_price || 
                    parseFloat(quantity) <= 0 || parseFloat(buying_price) <= 0) {
                    continue;
                }

                const qty = parseFloat(quantity);
                const buyingPrice = parseFloat(buying_price);
                const sellingPrice = parseFloat(selling_price) || buyingPrice * 1.3; // Default 30% markup
                const entryBuyingValue = qty * buyingPrice;
                const entrySellingValue = qty * sellingPrice;
                totalBuyingValue += entryBuyingValue;

                // Insert stock entry - supplier_id can be null
                await pool.execute(
                    `INSERT INTO stock_in 
                    (id, shop_id, product_id, batch_number, quantity, 
                    buying_price, selling_price, total_buying_value,
                    supplier_id, notes, received_by)
                    VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?, 
                            ?, ?, ?, ?, ?, UUID_TO_BIN(?))`,
                    [
                        req.shopId,
                        product_id,
                        batch_number || null,
                        qty,
                        buyingPrice,
                        sellingPrice,
                        entryBuyingValue,  // total_buying_value
                        supplier_id || null,
                        notes || null,
                        req.session.userId
                    ]
                );

                // Update inventory
                const [inventoryCheck] = await pool.execute(
                    `SELECT current_quantity, avg_cost 
                     FROM inventory 
                     WHERE product_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
                    [product_id, req.shopId]
                );

                if (inventoryCheck.length === 0) {
                    // Insert new inventory record
                    await pool.execute(
                        `INSERT INTO inventory (id, shop_id, product_id, current_quantity, avg_cost, selling_price)
                         VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?, ?)`,
                        [req.shopId, product_id, qty, buyingPrice, sellingPrice]
                    );
                } else {
                    const currentQty = parseFloat(inventoryCheck[0].current_quantity);
                    const currentAvg = parseFloat(inventoryCheck[0].avg_cost);
                    const newAvg = ((currentQty * currentAvg) + entryBuyingValue) / (currentQty + qty);

                    // Update selling price if provided
                    if (sellingPrice > 0) {
                        await pool.execute(
                            `UPDATE inventory 
                             SET current_quantity = current_quantity + ?,
                                 avg_cost = ?,
                                 selling_price = ?,
                                 updated_at = NOW()
                             WHERE product_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
                            [qty, newAvg, sellingPrice, product_id, req.shopId]
                        );
                    } else {
                        await pool.execute(
                            `UPDATE inventory 
                             SET current_quantity = current_quantity + ?,
                                 avg_cost = ?,
                                 updated_at = NOW()
                             WHERE product_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
                            [qty, newAvg, product_id, req.shopId]
                        );
                    }
                }

                // Get product info for response
                const [productInfo] = await pool.execute(
                    `SELECT name FROM products WHERE id = UUID_TO_BIN(?)`,
                    [product_id]
                );

                results.push({
                    product_id,
                    product_name: productInfo[0]?.name || 'Unknown',
                    quantity: qty,
                    buying_price: buyingPrice,
                    selling_price: sellingPrice,
                    buying_total: entryBuyingValue
                });
            }

            // Handle supplier transactions ONLY if supplier exists
            const paymentAmount = parseFloat(payment_amount) || 0;
            
            if (supplier_id) {
                // Only process supplier transactions if supplier is selected
                if (transaction_type === 'credit') {
                    // For credit purchase, add to supplier balance
                    await recordSupplierTransaction(supplier_id, 'debit', totalBuyingValue, 
                        `Credit purchase - Batch: ${batch_number || 'No batch'}`, req);
                    
                } else if (transaction_type === 'cash') {
                    // For cash purchase with supplier, record purchase and payment
                    await recordSupplierTransaction(supplier_id, 'debit', totalBuyingValue, 
                        `Cash purchase - Batch: ${batch_number || 'No batch'}`, req);
                    
                    // Record cash payment
                    await recordSupplierTransaction(supplier_id, 'credit', paymentAmount, 
                        `Cash payment for batch: ${batch_number || 'No batch'}`, req);
                    
                } else if (transaction_type === 'partial') {
                    // For partial payment
                    await recordSupplierTransaction(supplier_id, 'debit', totalBuyingValue, 
                        `Purchase with partial payment - Batch: ${batch_number || 'No batch'}`, req);
                    
                    // Record partial payment
                    await recordSupplierTransaction(supplier_id, 'credit', paymentAmount, 
                        `Partial payment for batch: ${batch_number || 'No batch'}`, req);
                }

                // Get supplier info
                const [supplierInfo] = await pool.execute(
                    `SELECT name FROM suppliers WHERE id = UUID_TO_BIN(?)`,
                    [supplier_id]
                );

                results.push({
                    supplier: supplierInfo[0]?.name || 'Unknown',
                    transaction_type: transaction_type,
                    total_purchase: totalBuyingValue,
                    payment_made: paymentAmount,
                    balance_after: (await getSupplierBalance(supplier_id, req)).balance
                });
            } else {
                // No supplier - just log it
                results.push({
                    supplier: 'No Supplier (Self Purchase)',
                    transaction_type: transaction_type,
                    total_purchase: totalBuyingValue,
                    payment_made: paymentAmount
                });
            }

            // Commit transaction
            await pool.query('COMMIT');

            res.json({
                success: true,
                message: `Stock added successfully for ${results.length - 1} products`,
                results: results,
                total_buying_value: totalBuyingValue,
                batch_number: batch_number,
                receipt_id: Date.now().toString()
            });

        } catch (error) {
            // Rollback on error
            await pool.query('ROLLBACK');
            throw error;
        }
    } catch (err) {
        console.error('Error adding bulk stock:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Error adding stock'
        });
    }
});

// Helper function to record supplier transaction
async function recordSupplierTransaction(supplierId, type, amount, description, req) {
    const { pool, shopId } = req;
    
    // Record transaction
    await pool.execute(
        `INSERT INTO supplier_transactions 
         (id, shop_id, supplier_id, type, amount, description, created_by)
         VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?, ?, UUID_TO_BIN(?))`,
        [shopId, supplierId, type, amount, description, req.session.userId]
    );

    // Update supplier balance
    const [balanceCheck] = await pool.execute(
        `SELECT id FROM supplier_balance 
         WHERE shop_id = UUID_TO_BIN(?) AND supplier_id = UUID_TO_BIN(?)`,
        [shopId, supplierId]
    );

    if (balanceCheck.length === 0) {
        // Create new balance record
        await pool.execute(
            `INSERT INTO supplier_balance (id, shop_id, supplier_id, total_debit, total_credit)
             VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?)`,
            [shopId, supplierId, 
             type === 'debit' ? amount : 0,
             type === 'credit' ? amount : 0]
        );
    } else {
        // Update existing balance
        if (type === 'debit') {
            await pool.execute(
                `UPDATE supplier_balance 
                 SET total_debit = total_debit + ?, 
                     updated_at = NOW()
                 WHERE shop_id = UUID_TO_BIN(?) AND supplier_id = UUID_TO_BIN(?)`,
                [amount, shopId, supplierId]
            );
        } else {
            await pool.execute(
                `UPDATE supplier_balance 
                 SET total_credit = total_credit + ?, 
                     updated_at = NOW()
                 WHERE shop_id = UUID_TO_BIN(?) AND supplier_id = UUID_TO_BIN(?)`,
                [amount, shopId, supplierId]
            );
        }
    }
}

// Helper function to get supplier balance
async function getSupplierBalance(supplierId, req) {
    const { pool, shopId } = req;
    
    const [balance] = await pool.execute(
        `SELECT 
            total_debit,
            total_credit,
            (total_debit - total_credit) as balance
         FROM supplier_balance 
         WHERE supplier_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
        [supplierId, shopId]
    );

    return balance[0] || { total_debit: 0, total_credit: 0, balance: 0 };
}

// GET stock receipt
router.get('/stock/receipt/:receiptId', getShopInfo, async (req, res) => {
    try {
        const { receiptId } = req.params;
        const { batch_number, supplier_id, total_buying_value, payment_amount, transaction_type, results } = req.query;

        // Get user info
        const [userInfo] = await pool.execute(
            `SELECT name FROM users WHERE id = UUID_TO_BIN(?)`,
            [req.session.userId]
        );

        // Get shop info
        const [shopInfo] = await pool.execute(
            `SELECT name, address, phone FROM shops WHERE id = UUID_TO_BIN(?)`,
            [req.shopId]
        );

        // Parse results
        let parsedResults = [];
        if (results) {
            parsedResults = JSON.parse(decodeURIComponent(results));
        }

        // Calculate total value from results if not provided
        let totalValue = parseFloat(total_buying_value) || 0;
        if (totalValue === 0 && Array.isArray(parsedResults)) {
            parsedResults.forEach(item => {
                if (item.buying_total) {
                    totalValue += parseFloat(item.buying_total);
                }
            });
        }

        res.render('products/stock-receipt', {
            title: 'Stock Receipt',
            receipt_id: receiptId,
            batch_number: batch_number,
            supplier_id: supplier_id,
            total_value: totalValue,
            payment_amount: payment_amount,
            transaction_type: transaction_type,
            results: parsedResults,
            user: userInfo[0] || { name: 'Unknown' },
            shop: {
                ...req.shop,
                ...shopInfo[0]
            },
            printDate: new Date().toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })
        });
    } catch (err) {
        console.error('Error generating receipt:', err);
        res.status(500).render('error', {
            title: 'Error',
            message: 'Error generating receipt'
        });
    }
});

// GET supplier balance
router.get('/suppliers/:id/balance', getShopInfo, async (req, res) => {
    try {
        const supplierId = req.params.id;

        const [balance] = await pool.execute(
            `SELECT 
                total_debit,
                total_credit,
                balance
             FROM supplier_balance 
             WHERE supplier_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [supplierId, req.shopId]
        );

        res.json({
            success: true,
            balance: balance[0] || { total_debit: 0, total_credit: 0, balance: 0 }
        });
    } catch (err) {
        console.error('Error fetching supplier balance:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching supplier balance'
        });
    }
});

// GET product details with pricing info for stock addition
router.get('/:id/details', getShopInfo, async (req, res) => {
    try {
        const productId = req.params.id;
        
        // Get product details with inventory info
        const [products] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(p.id) as id,
                p.name,
                p.brand,
                p.category,
                p.size,
                p.sku,
                p.barcode,
                COALESCE(i.current_quantity, 0) as current_stock,
                COALESCE(i.avg_cost, 0) as avg_cost,
                p.status
             FROM products p
             LEFT JOIN inventory i ON p.id = i.product_id
             WHERE p.id = UUID_TO_BIN(?) AND p.shop_id = UUID_TO_BIN(?)`,
            [productId, req.shopId]
        );
        
        if (products.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found' 
            });
        }

        // Get last purchase price from stock_in table
        const [lastPurchase] = await pool.execute(
            `SELECT unit_price 
             FROM stock_in 
             WHERE product_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)
             ORDER BY created_at DESC 
             LIMIT 1`,
            [productId, req.shopId]
        );

        // Get ingredients if any
        const [ingredients] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(i.raw_material_id) as raw_material_id,
                rm.name as raw_material_name,
                rm.sku as raw_material_sku,
                rm.current_stock,
                rm.unit_of_measure,
                i.quantity_required,
                i.unit
             FROM ingredients i
             JOIN raw_materials rm ON i.raw_material_id = rm.id
             WHERE i.main_product_id = UUID_TO_BIN(?) AND i.shop_id = UUID_TO_BIN(?)`,
            [productId, req.shopId]
        );
        
        res.json({
            success: true,
            product: {
                ...products[0],
                last_purchase_price: lastPurchase[0]?.unit_price || products[0].avg_cost || 0,
                ingredients: ingredients || []
            }
        });
    } catch (err) {
        console.error('Error fetching product details:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error loading product details: ' + err.message
        });
    }
});

module.exports = router;