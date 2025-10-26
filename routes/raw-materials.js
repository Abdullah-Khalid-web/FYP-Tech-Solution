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

// Add this function to automatically generate stock alerts
// UPDATED Alert generation function
// UPDATED Alert generation function - ENHANCED VERSION
const generateStockAlerts = async (tablePrefix, materialId = null) => {
    try {
        console.log(`🔄 Starting alert generation for table: ${tablePrefix}`);

        // Ensure alerts table exists
        await createAlertsTable(tablePrefix);

        let whereClause = 'WHERE rm.is_active = TRUE';
        const queryParams = [];

        if (materialId) {
            whereClause += ' AND rm.id = ?';
            queryParams.push(materialId);
        }

        // Find materials that need alerts - IMPROVED QUERY
        const [materials] = await pool.execute(
            `SELECT 
                rm.id,
                rm.name,
                rm.current_stock,
                rm.min_stock_level,
                rm.max_stock_level
             FROM ${req.tablePrefix}raw_materials rm
             ${whereClause}`,
            queryParams
        );

        console.log(`🔍 Checking ${materials.length} materials for alerts`);

        let alertsGenerated = 0;

        for (const material of materials) {
            let alertType = null;
            let alertMessage = '';
            let currentValue = null;
            let thresholdValue = null;

            console.log(`📦 Material: ${material.name}, Stock: ${material.current_stock}, Min: ${material.min_stock_level}, Max: ${material.max_stock_level}`);

            // Check for critical stock (zero stock)
            if (material.current_stock === 0) {
                alertType = 'critical_stock';
                alertMessage = `${material.name} is out of stock`;
                currentValue = 0;
                thresholdValue = material.min_stock_level;
            }
            // Check for low stock (below min level but not zero)
            else if (material.min_stock_level > 0 && material.current_stock <= material.min_stock_level && material.current_stock > 0) {
                alertType = 'low_stock';
                alertMessage = `${material.name} is running low on stock (${material.current_stock} left, min: ${material.min_stock_level})`;
                currentValue = material.current_stock;
                thresholdValue = material.min_stock_level;
            }
            // Check for over stock (above max level)
            else if (material.max_stock_level > 0 && material.current_stock > material.max_stock_level) {
                alertType = 'over_stock';
                alertMessage = `${material.name} has excess stock (${material.current_stock} units, max: ${material.max_stock_level})`;
                currentValue = material.current_stock;
                thresholdValue = material.max_stock_level;
            }

            // Check if alert already exists for this material and type
            if (alertType) {
                const [existingAlerts] = await pool.execute(
                    `SELECT id FROM ${tablePrefix}raw_material_alerts 
                     WHERE raw_material_id = ? AND alert_type = ? AND is_resolved = FALSE`,
                    [material.id, alertType]
                );

                if (existingAlerts.length === 0) {
                    await pool.execute(
                        `INSERT INTO ${tablePrefix}raw_material_alerts 
                         (raw_material_id, alert_type, alert_message, current_value, threshold_value, is_resolved)
                         VALUES (?, ?, ?, ?, ?, FALSE)`,
                        [material.id, alertType, alertMessage, currentValue, thresholdValue]
                    );
                    console.log(`🚨 Generated ${alertType} alert for ${material.name}`);
                    alertsGenerated++;
                } else {
                    console.log(`ℹ️  Alert already exists for ${material.name} (${alertType})`);
                }
            }
        }

        console.log(`✅ Alert generation completed. ${alertsGenerated} new alerts generated.`);
        return alertsGenerated;

    } catch (error) {
        console.error('❌ Error generating stock alerts:', error);
        throw error;
    }
};

// GET raw materials main page
router.get('/', getShopPrefix, async (req, res) => {
    try {
        const isApiCall = req.headers['content-type'] === 'application/json' ||
            req.headers.accept?.includes('application/json') ||
            req.xhr;

        if (isApiCall) {
            // Get dashboard statistics
            const [materialCount] = await pool.execute(
                `SELECT COUNT(*) as total FROM ${req.tablePrefix}raw_materials WHERE is_active = TRUE`
            );

            const [lowStockCount] = await pool.execute(
                `SELECT COUNT(*) as total FROM ${req.tablePrefix}raw_materials 
                 WHERE is_active = TRUE AND current_stock <= min_stock_level AND current_stock > 0`
            );

            const [criticalStockCount] = await pool.execute(
                `SELECT COUNT(*) as total FROM ${req.tablePrefix}raw_materials 
                 WHERE is_active = TRUE AND current_stock = 0`
            );

            const [supplierCount] = await pool.execute(
                `SELECT COUNT(*) as total FROM ${req.tablePrefix}suppliers WHERE is_active = TRUE`
            );

            // Get recent stock movements
            const [recentMovements] = await pool.execute(
                `SELECT 
                    sm.*,
                    rm.name as material_name
                 FROM ${req.tablePrefix}raw_material_stock_movements sm
                 LEFT JOIN ${req.tablePrefix}raw_materials rm ON sm.raw_material_id = rm.id
                 ORDER BY sm.movement_date DESC, sm.created_at DESC
                 LIMIT 5`
            );

            // Get critical alerts
            const [criticalAlerts] = await pool.execute(
                `SELECT 
                    a.*,
                    rm.name as material_name
                 FROM ${req.tablePrefix}raw_material_alerts a
                 LEFT JOIN ${req.tablePrefix}raw_materials rm ON a.raw_material_id = rm.id
                 WHERE a.is_resolved = FALSE
                 ORDER BY a.created_at DESC
                 LIMIT 5`
            );

            return res.json({
                success: true,
                dashboardStats: {
                    totalMaterials: materialCount[0].total,
                    lowStockCount: lowStockCount[0].total,
                    criticalStockCount: criticalStockCount[0].total,
                    supplierCount: supplierCount[0].total
                },
                recentMovements: recentMovements,
                criticalAlerts: criticalAlerts
            });
        } else {
            // Get minimal data for initial page load
            const [materialCount] = await pool.execute(
                `SELECT COUNT(*) as total FROM ${req.tablePrefix}raw_materials WHERE is_active = TRUE`
            );

            const [supplierCount] = await pool.execute(
                `SELECT COUNT(*) as total FROM ${req.tablePrefix}raw_suppliers WHERE is_active = TRUE`
            );

            res.render('raw-materials/index', {
                title: 'Raw Product Management',
                shop: req.shop,
                dashboardStats: {
                    totalMaterials: materialCount[0].total,
                    lowStockCount: 0,
                    criticalStockCount: 0,
                    supplierCount: supplierCount[0].total
                },
                recentMovements: [],
                criticalAlerts: []
            });
        }
    } catch (err) {
        console.error('Error loading raw materials dashboard:', err);

        const isApiCall = req.headers['content-type'] === 'application/json' ||
            req.headers.accept?.includes('application/json');

        if (isApiCall) {
            return res.status(500).json({
                success: false,
                message: 'An error occurred while loading dashboard data'
            });
        }

        res.status(500).render('error', {
            title: 'Error',
            message: 'An error occurred while loading raw materials dashboard'
        });
    }
});

// GET raw materials data (for table)
router.get('/materials', getShopPrefix, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const { search, category, supplier, status, stock_status } = req.query;

        let whereClause = 'WHERE 1=1';
        const queryParams = [];

        if (search) {
            whereClause += ' AND (rm.name LIKE ? OR rm.sku LIKE ?)';
            queryParams.push(`%${search}%`, `%${search}%`);
        }

        if (category && category !== 'all') {
            whereClause += ' AND rm.category = ?';
            queryParams.push(category);
        }

        if (supplier && supplier !== 'all') {
            whereClause += ' AND s.name = ?';
            queryParams.push(supplier);
        }

        if (status && status !== 'all') {
            whereClause += ' AND rm.is_active = ?';
            queryParams.push(status === 'active');
        }

        if (stock_status && stock_status !== 'all') {
            if (stock_status === 'low') {
                whereClause += ' AND rm.current_stock <= rm.min_stock_level AND rm.current_stock > 0';
            } else if (stock_status === 'critical') {
                whereClause += ' AND rm.current_stock = 0';
            } else if (stock_status === 'over') {
                whereClause += ' AND rm.current_stock > rm.max_stock_level';
            }
        }

        // Get materials with supplier information
        const [materials] = await pool.execute(
            `SELECT 
                rm.*,
                s.name as supplier_name,
                CASE 
                    WHEN rm.current_stock = 0 THEN 'critical'
                    WHEN rm.current_stock <= rm.min_stock_level THEN 'low'
                    WHEN rm.current_stock > rm.max_stock_level THEN 'over'
                    ELSE 'normal'
                END as stock_status
             FROM ${req.tablePrefix}raw_materials rm
             LEFT JOIN ${req.tablePrefix}raw_suppliers s ON rm.supplier_id = s.id
             ${whereClause}
             ORDER BY rm.name
             LIMIT ? OFFSET ?`,
            [...queryParams, limit, offset]
        );

        // Get total count for pagination
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total 
             FROM ${req.tablePrefix}raw_materials rm
             LEFT JOIN ${req.tablePrefix}raw_suppliers s ON rm.supplier_id = s.id
             ${whereClause}`,
            queryParams
        );
        const total = countResult[0].total;

        // Get unique categories and suppliers for filters
        const [categories] = await pool.execute(
            `SELECT DISTINCT category FROM ${req.tablePrefix}raw_materials WHERE category IS NOT NULL ORDER BY category`
        );

        const [suppliers] = await pool.execute(
            `SELECT DISTINCT s.name 
             FROM ${req.tablePrefix}suppliers s
             JOIN ${req.tablePrefix}raw_materials rm ON s.id = rm.supplier_id
             WHERE s.is_active = TRUE
             ORDER BY s.name`
        );

        res.json({
            success: true,
            data: materials,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            },
            filters: {
                categories: categories.map(c => c.category),
                suppliers: suppliers.map(s => s.name)
            }
        });
    } catch (err) {
        console.error('Error fetching raw materials:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching raw materials'
        });
    }
});

// POST create new raw material - FIXED VERSION
// POST create new raw material - UPDATED WITH ALERT GENERATION
router.post('/materials', getShopPrefix, async (req, res) => {
    try {
        const {
            name,
            sku,
            barcode,
            category,
            description,
            unit_of_measure,
            current_stock,
            min_stock_level,
            max_stock_level,
            cost_price,
            supplier_id,
            batch_tracking,
            expiry_tracking
        } = req.body;

        // Validation
        if (!name || !cost_price) {
            return res.status(400).json({
                success: false,
                message: 'Name and cost price are required'
            });
        }

        // Insert into database
        const [result] = await pool.execute(
            `INSERT INTO ${req.tablePrefix}raw_materials 
             (shop_id, name, sku, barcode, category, description, unit_of_measure, 
              current_stock, min_stock_level, max_stock_level, cost_price, supplier_id,
              batch_tracking, expiry_tracking, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.session.shopId,
                name,
                sku || null,
                barcode || null,
                category || null,
                description || null,
                unit_of_measure || 'pcs',
                parseFloat(current_stock) || 0,
                parseFloat(min_stock_level) || 0,
                parseFloat(max_stock_level) || 0,
                parseFloat(cost_price),
                supplier_id || null,
                batch_tracking === 'true' || batch_tracking === true,
                expiry_tracking === 'true' || expiry_tracking === true,
                req.session.userId || 1
            ]
        );

        // Generate alerts for the new material
        await generateStockAlerts(req.tablePrefix, result.insertId);

        res.json({
            success: true,
            message: 'Raw material added successfully',
            materialId: result.insertId
        });
    } catch (err) {
        console.error('Error creating raw material:', err);
        res.status(500).json({
            success: false,
            message: 'Error creating raw material: ' + err.message
        });
    }
});

// PUT update material - UPDATED WITH ALERT GENERATION
router.put('/materials/:id', getShopPrefix, async (req, res) => {
    try {
        const materialId = req.params.id;
        const {
            name,
            sku,
            barcode,
            category,
            description,
            unit_of_measure,
            min_stock_level,
            max_stock_level,
            cost_price,
            supplier_id,
            batch_tracking,
            expiry_tracking,
            is_active
        } = req.body;

        // Validation
        if (!name || !cost_price) {
            return res.status(400).json({
                success: false,
                message: 'Name and cost price are required'
            });
        }

        // Check if material exists
        const [existingMaterials] = await pool.execute(
            `SELECT id FROM ${req.tablePrefix}raw_materials WHERE id = ?`,
            [materialId]
        );

        if (existingMaterials.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Material not found'
            });
        }

        // Update material
        await pool.execute(
            `UPDATE ${req.tablePrefix}raw_materials 
             SET name = ?, sku = ?, barcode = ?, category = ?, description = ?, 
                 unit_of_measure = ?, min_stock_level = ?, max_stock_level = ?, 
                 cost_price = ?, supplier_id = ?, batch_tracking = ?, expiry_tracking = ?,
                 is_active = ?, updated_at = NOW()
             WHERE id = ?`,
            [
                name,
                sku || null,
                barcode || null,
                category || null,
                description || null,
                unit_of_measure || 'pcs',
                parseFloat(min_stock_level) || 0,
                parseFloat(max_stock_level) || 0,
                parseFloat(cost_price),
                supplier_id || null,
                batch_tracking === 'true' || batch_tracking === true,
                expiry_tracking === 'true' || expiry_tracking === true,
                is_active === 'true' || is_active === true,
                materialId
            ]
        );

        // Generate alerts for the updated material
        await generateStockAlerts(req.tablePrefix, materialId);

        res.json({
            success: true,
            message: 'Material updated successfully'
        });
    } catch (err) {
        console.error('Error updating material:', err);
        res.status(500).json({
            success: false,
            message: 'Error updating material: ' + err.message
        });
    }
});

// GET single material for editing
router.get('/materials/:id', getShopPrefix, async (req, res) => {
    try {
        const materialId = req.params.id;

        const [materials] = await pool.execute(
            `SELECT 
                rm.*,
                s.name as supplier_name
             FROM ${req.tablePrefix}raw_materials rm
             LEFT JOIN ${req.tablePrefix}suppliers s ON rm.supplier_id = s.id
             WHERE rm.id = ?`,
            [materialId]
        );

        if (materials.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Material not found'
            });
        }

        res.json({
            success: true,
            data: materials[0]
        });
    } catch (err) {
        console.error('Error fetching material:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching material'
        });
    }
});

// PUT update material
router.put('/materials/:id', getShopPrefix, async (req, res) => {
    try {
        const materialId = req.params.id;
        const {
            name,
            sku,
            barcode,
            category,
            description,
            unit_of_measure,
            min_stock_level,
            max_stock_level,
            cost_price,
            supplier_id,
            batch_tracking,
            expiry_tracking,
            is_active
        } = req.body;

        console.log('Updating material:', materialId, req.body);

        // Validation
        if (!name || !cost_price) {
            return res.status(400).json({
                success: false,
                message: 'Name and cost price are required'
            });
        }

        // Check if material exists
        const [existingMaterials] = await pool.execute(
            `SELECT id FROM ${req.tablePrefix}raw_materials WHERE id = ?`,
            [materialId]
        );

        if (existingMaterials.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Material not found'
            });
        }

        // Update material
        await pool.execute(
            `UPDATE ${req.tablePrefix}raw_materials 
             SET name = ?, sku = ?, barcode = ?, category = ?, description = ?, 
                 unit_of_measure = ?, min_stock_level = ?, max_stock_level = ?, 
                 cost_price = ?, supplier_id = ?, batch_tracking = ?, expiry_tracking = ?,
                 is_active = ?, updated_at = NOW()
             WHERE id = ?`,
            [
                name,
                sku || null,
                barcode || null,
                category || null,
                description || null,
                unit_of_measure || 'pcs',
                parseFloat(min_stock_level) || 0,
                parseFloat(max_stock_level) || 0,
                parseFloat(cost_price),
                supplier_id || null,
                batch_tracking === 'true' || batch_tracking === true,
                expiry_tracking === 'true' || expiry_tracking === true,
                is_active === 'true' || is_active === true,
                materialId
            ]
        );

        res.json({
            success: true,
            message: 'Material updated successfully'
        });
    } catch (err) {
        console.error('Error updating material:', err);
        res.status(500).json({
            success: false,
            message: 'Error updating material: ' + err.message
        });
    }
});

// DELETE material (soft delete)
router.delete('/materials/:id', getShopPrefix, async (req, res) => {
    try {
        const materialId = req.params.id;

        // Check if material exists
        const [existingMaterials] = await pool.execute(
            `SELECT name, current_stock FROM ${req.tablePrefix}raw_materials WHERE id = ?`,
            [materialId]
        );

        if (existingMaterials.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Material not found'
            });
        }

        const material = existingMaterials[0];

        // Check if material has any stock movements (for safety)
        const [movements] = await pool.execute(
            `SELECT COUNT(*) as movement_count FROM ${req.tablePrefix}raw_material_stock_movements WHERE raw_material_id = ?`,
            [materialId]
        );

        const hasMovements = movements[0].movement_count > 0;

        // Soft delete - set is_active to false instead of actual deletion
        await pool.execute(
            `UPDATE ${req.tablePrefix}raw_materials 
             SET is_active = FALSE, updated_at = NOW()
             WHERE id = ?`,
            [materialId]
        );

        res.json({
            success: true,
            message: 'Material deleted successfully',
            materialName: material.name,
            hadMovements: hasMovements
        });

    } catch (err) {
        console.error('Error deleting material:', err);
        res.status(500).json({
            success: false,
            message: 'Error deleting material: ' + err.message
        });
    }
});

// Debug endpoint to check materials and their stock levels
router.get('/debug/materials-stock', getShopPrefix, async (req, res) => {
    try {
        const [materials] = await pool.execute(`
            SELECT 
                id,
                name,
                current_stock,
                min_stock_level,
                max_stock_level,
                CASE 
                    WHEN current_stock = 0 THEN 'critical'
                    WHEN current_stock <= min_stock_level THEN 'low'
                    WHEN current_stock > max_stock_level THEN 'over'
                    ELSE 'normal'
                END as stock_status
            FROM ${req.tablePrefix}raw_materials 
            WHERE is_active = TRUE
            ORDER BY name
        `);

        res.json({
            success: true,
            materials: materials,
            total: materials.length
        });
    } catch (error) {
        console.error('Debug error:', error);
        res.status(500).json({
            success: false,
            message: 'Debug error: ' + error.message
        });
    }
});

// Debug endpoint to manually trigger alert generation with detailed output
router.post('/debug/generate-alerts-manual', getShopPrefix, async (req, res) => {
    try {
        console.log('🔄 Manually generating alerts with detailed output...');
        
        // First, check current materials
        const [materials] = await pool.execute(`
            SELECT id, name, current_stock, min_stock_level, max_stock_level 
            FROM ${req.tablePrefix}raw_materials 
            WHERE is_active = TRUE
        `);

        console.log('📦 Current materials:', materials);

        // Generate alerts
        const alertsGenerated = await generateStockAlerts(req.tablePrefix);

        // Get current alert count
        const [unresolvedCount] = await pool.execute(
            `SELECT COUNT(*) as total FROM ${req.tablePrefix}raw_material_alerts WHERE is_resolved = FALSE`
        );

        const [allAlerts] = await pool.execute(
            `SELECT * FROM ${req.tablePrefix}raw_material_alerts ORDER BY created_at DESC LIMIT 10`
        );

        res.json({
            success: true,
            message: `Alert generation completed. ${alertsGenerated} new alerts generated.`,
            materialsChecked: materials.length,
            unresolvedCount: unresolvedCount[0].total,
            recentAlerts: allAlerts,
            materials: materials
        });
    } catch (error) {
        console.error('Error in manual alert generation:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating alerts: ' + error.message
        });
    }
});

// GET suppliers data
router.get('/suppliers', getShopPrefix, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const { search, status, rating } = req.query;

        let whereClause = 'WHERE 1=1';
        const queryParams = [];

        if (search) {
            whereClause += ' AND (s.name LIKE ? OR s.contact_person LIKE ? OR s.email LIKE ?)';
            queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (status && status !== 'all') {
            whereClause += ' AND s.is_active = ?';
            queryParams.push(status === 'active');
        }

        if (rating && rating !== 'all') {
            whereClause += ' AND s.rating = ?';
            queryParams.push(parseInt(rating));
        }

        // Get suppliers with material count
        const [suppliers] = await pool.execute(
            `SELECT 
                s.*,
                COUNT(rm.id) as materials_count
             FROM ${req.tablePrefix}raw_suppliers s
             LEFT JOIN ${req.tablePrefix}raw_materials rm ON s.id = rm.supplier_id
             ${whereClause}
             GROUP BY s.id
             ORDER BY s.name
             LIMIT ? OFFSET ?`,
            [...queryParams, limit, offset]
        );

        // Get total count for pagination
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM ${req.tablePrefix}raw_suppliers s ${whereClause}`,
            queryParams
        );
        const total = countResult[0].total;

        res.json({
            success: true,
            data: suppliers,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Error fetching suppliers:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching suppliers'
        });
    }
});

// POST create new supplier
router.post('/suppliers', getShopPrefix, async (req, res) => {
    try {
        const {
            name,
            contact_person,
            email,
            phone,
            address,
            tax_number,
            payment_terms,
            rating,
            notes,
            is_active
        } = req.body;

        // Validation
        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'Supplier name is required'
            });
        }

        await pool.execute(
            `INSERT INTO ${req.tablePrefix}raw_suppliers 
             (shop_id, name, contact_person, email, phone, address, tax_number, 
              payment_terms, rating, notes, is_active, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.session.shopId,
                name,
                contact_person || null,
                email || null,
                phone || null,
                address || null,
                tax_number || null,
                payment_terms || null,
                parseInt(rating) || 5,
                notes || null,
                is_active === 'true' || is_active === true,
                req.session.userId || 1
            ]
        );

        res.json({
            success: true,
            message: 'Supplier added successfully'
        });
    } catch (err) {
        console.error('Error creating supplier:', err);
        res.status(500).json({
            success: false,
            message: 'Error creating supplier'
        });
    }
});

// GET single supplier for editing
router.get('/suppliers/:id', getShopPrefix, async (req, res) => {
    try {
        const supplierId = req.params.id;

        const [suppliers] = await pool.execute(
            `SELECT * FROM ${req.tablePrefix}raw_suppliers WHERE id = ?`,
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
            data: suppliers[0]
        });
    } catch (err) {
        console.error('Error fetching supplier:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching supplier'
        });
    }
});

// PUT update supplier
router.put('/suppliers/:id', getShopPrefix, async (req, res) => {
    try {
        const supplierId = req.params.id;
        const {
            name,
            contact_person,
            email,
            phone,
            address,
            tax_number,
            payment_terms,
            rating,
            notes,
            is_active
        } = req.body;

        console.log('Updating supplier:', supplierId, req.body);

        // Validation
        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'Supplier name is required'
            });
        }

        // Check if supplier exists
        const [existingSuppliers] = await pool.execute(
            `SELECT id FROM ${req.tablePrefix}raw_suppliers WHERE id = ?`,
            [supplierId]
        );

        if (existingSuppliers.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Supplier not found'
            });
        }

        // Update supplier
        await pool.execute(
            `UPDATE ${req.tablePrefix}raw_suppliers 
             SET name = ?, contact_person = ?, email = ?, phone = ?, address = ?,
                 tax_number = ?, payment_terms = ?, rating = ?, notes = ?, is_active = ?,
                 updated_at = NOW()
             WHERE id = ?`,
            [
                name,
                contact_person || null,
                email || null,
                phone || null,
                address || null,
                tax_number || null,
                payment_terms || null,
                parseInt(rating) || 5,
                notes || null,
                is_active === 'true' || is_active === true,
                supplierId
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
            message: 'Error updating supplier: ' + err.message
        });
    }
});

// DELETE supplier (soft delete)
router.delete('/suppliers/:id', getShopPrefix, async (req, res) => {
    try {
        const supplierId = req.params.id;

        // Check if supplier exists
        const [existingSuppliers] = await pool.execute(
            `SELECT name FROM ${req.tablePrefix}raw_suppliers WHERE id = ?`,
            [supplierId]
        );

        if (existingSuppliers.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Supplier not found'
            });
        }

        const supplierName = existingSuppliers[0].name;

        // Check if supplier has associated materials
        const [materials] = await pool.execute(
            `SELECT COUNT(*) as material_count FROM ${req.tablePrefix}raw_materials 
             WHERE supplier_id = ? AND is_active = TRUE`,
            [supplierId]
        );

        const hasMaterials = materials[0].material_count > 0;

        if (hasMaterials) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete supplier with associated active materials. Please reassign or deactivate materials first.'
            });
        }

        // Soft delete - set is_active to false
        await pool.execute(
            `UPDATE ${req.tablePrefix}raw_suppliers 
             SET is_active = FALSE, updated_at = NOW()
             WHERE id = ?`,
            [supplierId]
        );

        res.json({
            success: true,
            message: 'Supplier deleted successfully',
            supplierName: supplierName
        });

    } catch (err) {
        console.error('Error deleting supplier:', err);
        res.status(500).json({
            success: false,
            message: 'Error deleting supplier: ' + err.message
        });
    }
});

// GET stock alerts
router.get('/alerts', getShopPrefix, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const { alert_type, status } = req.query;

        let whereClause = 'WHERE 1=1';
        const queryParams = [];

        if (alert_type && alert_type !== 'all') {
            whereClause += ' AND a.alert_type = ?';
            queryParams.push(alert_type);
        }

        if (status && status !== 'all') {
            whereClause += ' AND a.is_resolved = ?';
            queryParams.push(status === 'resolved');
        }

        // Get alerts with material information
        const [alerts] = await pool.execute(
            `SELECT 
                a.*,
                rm.name as material_name
             FROM ${req.tablePrefix}raw_material_alerts a
             LEFT JOIN ${req.tablePrefix}raw_materials rm ON a.raw_material_id = rm.id
             ${whereClause}
             ORDER BY a.created_at DESC
             LIMIT ? OFFSET ?`,
            [...queryParams, limit, offset]
        );

        // Get total count for pagination
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM ${req.tablePrefix}raw_material_alerts a ${whereClause}`,
            queryParams
        );
        const total = countResult[0].total;

        // Get unresolved count for badge
        const [unresolvedCount] = await pool.execute(
            `SELECT COUNT(*) as total FROM ${req.tablePrefix}raw_material_alerts WHERE is_resolved = FALSE`
        );

        res.json({
            success: true,
            data: alerts,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            },
            unresolvedCount: unresolvedCount[0].total
        });
    } catch (err) {
        console.error('Error fetching alerts:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching alerts'
        });
    }
});

// POST resolve alert
router.post('/alerts/:id/resolve', getShopPrefix, async (req, res) => {
    try {
        const alertId = req.params.id;

        await pool.execute(
            `UPDATE ${req.tablePrefix}raw_material_alerts 
             SET is_resolved = TRUE, resolved_by = ?, resolved_at = NOW()
             WHERE id = ?`,
            [req.session.userId || 1, alertId]
        );

        res.json({
            success: true,
            message: 'Alert resolved successfully'
        });
    } catch (err) {
        console.error('Error resolving alert:', err);
        res.status(500).json({
            success: false,
            message: 'Error resolving alert'
        });
    }
});

// POST resolve all alerts
router.post('/alerts/resolve-all', getShopPrefix, async (req, res) => {
    try {
        await pool.execute(
            `UPDATE ${req.tablePrefix}raw_material_alerts 
             SET is_resolved = TRUE, resolved_by = ?, resolved_at = NOW()
             WHERE is_resolved = FALSE`,
            [req.session.userId || 1]
        );

        res.json({
            success: true,
            message: 'All alerts resolved successfully'
        });
    } catch (err) {
        console.error('Error resolving all alerts:', err);
        res.status(500).json({
            success: false,
            message: 'Error resolving all alerts'
        });
    }
});

// Manual alert generation endpoint
router.post('/alerts/generate-all', getShopPrefix, async (req, res) => {
    try {
        console.log('🔄 Manually generating alerts for all materials...');
        await generateStockAlerts(req.tablePrefix);
        
        // Get the new alert count
        const [unresolvedCount] = await pool.execute(
            `SELECT COUNT(*) as total FROM ${req.tablePrefix}raw_material_alerts WHERE is_resolved = FALSE`
        );

        res.json({
            success: true,
            message: 'Stock alerts generated successfully',
            unresolvedCount: unresolvedCount[0].total
        });
    } catch (err) {
        console.error('Error generating alerts:', err);
        res.status(500).json({
            success: false,
            message: 'Error generating alerts: ' + err.message
        });
    }
});

// ADD THIS DEBUG ENDPOINT TO CHECK ALERTS TABLE
router.get('/debug/alerts-table', getShopPrefix, async (req, res) => {
    try {
        // Check if alerts table exists
        const [tables] = await pool.execute(
            `SHOW TABLES LIKE '${req.tablePrefix}raw_material_alerts'`
        );
        
        const tableExists = tables.length > 0;
        
        if (!tableExists) {
            return res.json({
                success: false,
                message: 'Alerts table does not exist',
                tableName: `${req.tablePrefix}raw_material_alerts`
            });
        }

        // Check table structure
        const [columns] = await pool.execute(
            `DESCRIBE ${req.tablePrefix}raw_material_alerts`
        );

        // Count alerts
        const [alertCount] = await pool.execute(
            `SELECT COUNT(*) as total FROM ${req.tablePrefix}raw_material_alerts`
        );

        // Get sample alerts
        const [alerts] = await pool.execute(
            `SELECT * FROM ${req.tablePrefix}raw_material_alerts LIMIT 5`
        );

        res.json({
            success: true,
            tableExists: true,
            tableName: `${req.tablePrefix}raw_material_alerts`,
            columnCount: columns.length,
            alertCount: alertCount[0].total,
            columns: columns,
            sampleAlerts: alerts
        });

    } catch (err) {
        console.error('Debug error:', err);
        res.status(500).json({
            success: false,
            message: 'Debug error: ' + err.message
        });
    }
});

// GET batch movements
router.get('/batches', getShopPrefix, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const { search, material_id, reference_type } = req.query;

        let whereClause = 'WHERE 1=1';
        const queryParams = [];

        if (search) {
            whereClause += ' AND (sm.batch_number LIKE ? OR sm.reference_id LIKE ?)';
            queryParams.push(`%${search}%`, `%${search}%`);
        }

        if (material_id && material_id !== 'all') {
            whereClause += ' AND sm.raw_material_id = ?';
            queryParams.push(parseInt(material_id));
        }

        if (reference_type && reference_type !== 'all') {
            whereClause += ' AND sm.reference_type = ?';
            queryParams.push(reference_type);
        }

        // Get batch movements with material information
        const [batches] = await pool.execute(
            `SELECT 
                sm.*,
                rm.name as material_name
             FROM ${req.tablePrefix}raw_material_stock_movements sm
             LEFT JOIN ${req.tablePrefix}raw_materials rm ON sm.raw_material_id = rm.id
             ${whereClause}
             ORDER BY sm.movement_date DESC, sm.created_at DESC
             LIMIT ? OFFSET ?`,
            [...queryParams, limit, offset]
        );

        // Get total count for pagination
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM ${req.tablePrefix}raw_material_stock_movements sm ${whereClause}`,
            queryParams
        );
        const total = countResult[0].total;

        res.json({
            success: true,
            data: batches,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Error fetching batches:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching batches'
        });
    }
});

// POST create stock movement
// POST create stock movement - UPDATED WITH ALERT GENERATION
router.post('/batches', getShopPrefix, async (req, res) => {
    try {
        const {
            raw_material_id,
            batch_number,
            movement_type,
            quantity,
            unit_cost,
            reference_type,
            reference_id,
            notes,
            movement_date,
            expiry_date
        } = req.body;

        // Validation
        if (!raw_material_id || !movement_type || !quantity || !movement_date) {
            return res.status(400).json({
                success: false,
                message: 'Material, movement type, quantity, and date are required'
            });
        }

        const total_cost = parseFloat(quantity) * parseFloat(unit_cost || 0);

        await pool.execute(
            `INSERT INTO ${req.tablePrefix}raw_material_stock_movements 
             (shop_id, raw_material_id, batch_number, movement_type, quantity, 
              unit_cost, total_cost, reference_type, reference_id, notes, movement_date, expiry_date, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.session.shopId,
                raw_material_id,
                batch_number || null,
                movement_type,
                parseFloat(quantity),
                parseFloat(unit_cost) || 0,
                total_cost,
                reference_type || 'adjustment',
                reference_id || null,
                notes || null,
                movement_date,
                expiry_date || null,
                req.session.userId || 1
            ]
        );

        // Update material stock level
        const materialUpdateQuery = movement_type === 'in'
            ? `UPDATE ${req.tablePrefix}raw_materials SET current_stock = current_stock + ? WHERE id = ?`
            : `UPDATE ${req.tablePrefix}raw_materials SET current_stock = current_stock - ? WHERE id = ?`;

        await pool.execute(materialUpdateQuery, [parseFloat(quantity), raw_material_id]);

        // Generate alerts for this material
        await generateStockAlerts(req.tablePrefix, raw_material_id);

        res.json({
            success: true,
            message: 'Stock movement recorded successfully'
        });
    } catch (err) {
        console.error('Error creating stock movement:', err);
        res.status(500).json({
            success: false,
            message: 'Error creating stock movement'
        });
    }
});

// GET single batch for editing
router.get('/batches/:id', getShopPrefix, async (req, res) => {
    try {
        const batchId = req.params.id;

        const [batches] = await pool.execute(
            `SELECT 
                sm.*,
                rm.name as material_name,
                rm.unit_of_measure
             FROM ${req.tablePrefix}raw_material_stock_movements sm
             LEFT JOIN ${req.tablePrefix}raw_materials rm ON sm.raw_material_id = rm.id
             WHERE sm.id = ?`,
            [batchId]
        );

        if (batches.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Batch not found'
            });
        }

        res.json({
            success: true,
            data: batches[0]
        });
    } catch (err) {
        console.error('Error fetching batch:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching batch'
        });
    }
});

// PUT update batch
// PUT update batch - FIXED VERSION (without updated_at)
router.put('/batches/:id', getShopPrefix, async (req, res) => {
    try {
        const batchId = req.params.id;
        const {
            raw_material_id,
            batch_number,
            movement_type,
            quantity,
            unit_cost,
            reference_type,
            reference_id,
            notes,
            movement_date,
            expiry_date
        } = req.body;

        console.log('Updating batch:', batchId, req.body);

        // Validation
        if (!raw_material_id || !movement_type || !quantity || !movement_date) {
            return res.status(400).json({
                success: false,
                message: 'Material, movement type, quantity, and date are required'
            });
        }

        // Check if batch exists
        const [existingBatches] = await pool.execute(
            `SELECT * FROM ${req.tablePrefix}raw_material_stock_movements WHERE id = ?`,
            [batchId]
        );

        if (existingBatches.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Batch not found'
            });
        }

        const oldBatch = existingBatches[0];
        const total_cost = parseFloat(quantity) * parseFloat(unit_cost || 0);

        // Start transaction for data consistency
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // First, reverse the old stock movement
            const reverseQuery = oldBatch.movement_type === 'in'
                ? `UPDATE ${req.tablePrefix}raw_materials SET current_stock = current_stock - ? WHERE id = ?`
                : `UPDATE ${req.tablePrefix}raw_materials SET current_stock = current_stock + ? WHERE id = ?`;

            await connection.execute(reverseQuery, [oldBatch.quantity, oldBatch.raw_material_id]);

            // Update the batch record - REMOVED updated_at
            await connection.execute(
                `UPDATE ${req.tablePrefix}raw_material_stock_movements 
                 SET raw_material_id = ?, batch_number = ?, movement_type = ?, quantity = ?, 
                     unit_cost = ?, total_cost = ?, reference_type = ?, reference_id = ?, 
                     notes = ?, movement_date = ?, expiry_date = ?
                 WHERE id = ?`,
                [
                    raw_material_id,
                    batch_number || null,
                    movement_type,
                    parseFloat(quantity),
                    parseFloat(unit_cost) || 0,
                    total_cost,
                    reference_type || 'adjustment',
                    reference_id || null,
                    notes || null,
                    movement_date,
                    expiry_date || null,
                    batchId
                ]
            );

            // Apply the new stock movement
            const applyQuery = movement_type === 'in'
                ? `UPDATE ${req.tablePrefix}raw_materials SET current_stock = current_stock + ? WHERE id = ?`
                : `UPDATE ${req.tablePrefix}raw_materials SET current_stock = current_stock - ? WHERE id = ?`;

            await connection.execute(applyQuery, [parseFloat(quantity), raw_material_id]);

            // Generate alerts for the material
            await generateStockAlerts(req.tablePrefix, raw_material_id);

            await connection.commit();

            res.json({
                success: true,
                message: 'Batch updated successfully'
            });

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

    } catch (err) {
        console.error('Error updating batch:', err);
        res.status(500).json({
            success: false,
            message: 'Error updating batch: ' + err.message
        });
    }
});

// DELETE batch
router.delete('/batches/:id', getShopPrefix, async (req, res) => {
    try {
        const batchId = req.params.id;

        // Check if batch exists
        const [existingBatches] = await pool.execute(
            `SELECT * FROM ${req.tablePrefix}raw_material_stock_movements WHERE id = ?`,
            [batchId]
        );

        if (existingBatches.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Batch not found'
            });
        }

        const batch = existingBatches[0];
        const materialId = batch.raw_material_id;

        // Start transaction for data consistency
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // Reverse the stock movement
            const reverseQuery = batch.movement_type === 'in'
                ? `UPDATE ${req.tablePrefix}raw_materials SET current_stock = current_stock - ? WHERE id = ?`
                : `UPDATE ${req.tablePrefix}raw_materials SET current_stock = current_stock + ? WHERE id = ?`;

            await connection.execute(reverseQuery, [batch.quantity, materialId]);

            // Delete the batch record
            await connection.execute(
                `DELETE FROM ${req.tablePrefix}raw_material_stock_movements WHERE id = ?`,
                [batchId]
            );

            // Generate alerts for the material
            await generateStockAlerts(req.tablePrefix, materialId);

            await connection.commit();

            res.json({
                success: true,
                message: 'Batch deleted successfully',
                batchInfo: {
                    batchNumber: batch.batch_number,
                    materialId: materialId,
                    quantity: batch.quantity,
                    movementType: batch.movement_type
                }
            });

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

    } catch (err) {
        console.error('Error deleting batch:', err);
        res.status(500).json({
            success: false,
            message: 'Error deleting batch: ' + err.message
        });
    }
});

// GET cost analysis data
// GET cost analysis data - FIXED VERSION
router.get('/cost-analysis', getShopPrefix, async (req, res) => {
    try {
        const { period, material_id, supplier_id, start_date, end_date } = req.query;

        console.log('📊 Cost analysis request:', { period, material_id, supplier_id, start_date, end_date });

        // Build date range condition
        let dateRangeCondition = '';
        const dateParams = [];

        if (start_date && end_date) {
            dateRangeCondition = 'AND sm.movement_date BETWEEN ? AND ?';
            dateParams.push(start_date, end_date);
        } else {
            // Default to last 12 months
            dateRangeCondition = 'AND sm.movement_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)';
        }

        // 1. Total inventory value
        let inventoryValueQuery = `
            SELECT COALESCE(SUM(rm.current_stock * rm.cost_price), 0) as total_value
            FROM ${req.tablePrefix}raw_materials rm
            WHERE rm.is_active = TRUE
        `;
        const inventoryParams = [];

        if (material_id) {
            inventoryValueQuery += ' AND rm.id = ?';
            inventoryParams.push(material_id);
        }

        if (supplier_id) {
            inventoryValueQuery += ' AND rm.supplier_id = ?';
            inventoryParams.push(supplier_id);
        }

        const [inventoryValue] = await pool.execute(inventoryValueQuery, inventoryParams);

        // 2. Monthly material cost (current month)
        let monthlyCostQuery = `
            SELECT COALESCE(SUM(sm.total_cost), 0) as monthly_cost
            FROM ${req.tablePrefix}raw_material_stock_movements sm
            WHERE sm.movement_type = 'in' 
            AND YEAR(sm.movement_date) = YEAR(CURDATE()) 
            AND MONTH(sm.movement_date) = MONTH(CURDATE())
        `;
        const monthlyParams = [];

        if (material_id) {
            monthlyCostQuery += ' AND sm.raw_material_id = ?';
            monthlyParams.push(material_id);
        }

        const [monthlyCost] = await pool.execute(monthlyCostQuery, monthlyParams);

        // 3. Average cost per unit
        let avgCostQuery = `
            SELECT 
                COALESCE(AVG(rm.cost_price), 0) as avg_cost,
                COUNT(*) as material_count
            FROM ${req.tablePrefix}raw_materials rm
            WHERE rm.is_active = TRUE
        `;
        const avgCostParams = [];

        if (material_id) {
            avgCostQuery += ' AND rm.id = ?';
            avgCostParams.push(material_id);
        }

        if (supplier_id) {
            avgCostQuery += ' AND rm.supplier_id = ?';
            avgCostParams.push(supplier_id);
        }

        const [avgCost] = await pool.execute(avgCostQuery, avgCostParams);

        // 4. Cost trends by period
        let groupBy = '';
        let dateFormat = '';
        
        switch (period) {
            case 'monthly':
                groupBy = 'DATE_FORMAT(sm.movement_date, "%Y-%m")';
                dateFormat = '%Y-%m';
                break;
            case 'quarterly':
                groupBy = 'CONCAT(YEAR(sm.movement_date), "-Q", QUARTER(sm.movement_date))';
                break;
            case 'yearly':
            default:
                groupBy = 'YEAR(sm.movement_date)';
                dateFormat = '%Y';
                break;
        }

        let costTrendsQuery = `
            SELECT 
                ${groupBy} as period,
                SUM(sm.total_cost) as total_cost,
                COUNT(*) as movement_count
            FROM ${req.tablePrefix}raw_material_stock_movements sm
            WHERE sm.movement_type = 'in' 
            ${dateRangeCondition}
        `;
        const trendParams = [...dateParams];

        if (material_id) {
            costTrendsQuery += ' AND sm.raw_material_id = ?';
            trendParams.push(material_id);
        }

        costTrendsQuery += ` GROUP BY ${groupBy} ORDER BY period`;

        const [costTrends] = await pool.execute(costTrendsQuery, trendParams);

        // 5. Cost by category
        let costByCategoryQuery = `
            SELECT 
                COALESCE(rm.category, 'Uncategorized') as category,
                SUM(rm.current_stock * rm.cost_price) as inventory_value,
                COUNT(*) as material_count
            FROM ${req.tablePrefix}raw_materials rm
            WHERE rm.is_active = TRUE
        `;
        const categoryParams = [];

        if (material_id) {
            costByCategoryQuery += ' AND rm.id = ?';
            categoryParams.push(material_id);
        }

        if (supplier_id) {
            costByCategoryQuery += ' AND rm.supplier_id = ?';
            categoryParams.push(supplier_id);
        }

        costByCategoryQuery += ` GROUP BY rm.category ORDER BY inventory_value DESC`;

        const [costByCategory] = await pool.execute(costByCategoryQuery, categoryParams);

        console.log('📊 Cost analysis results:', {
            inventoryValue: inventoryValue[0].total_value,
            monthlyCost: monthlyCost[0].monthly_cost,
            avgCost: avgCost[0].avg_cost,
            trendsCount: costTrends.length,
            categoriesCount: costByCategory.length
        });

        res.json({
            success: true,
            data: {
                inventoryValue: parseFloat(inventoryValue[0].total_value),
                monthlyCost: parseFloat(monthlyCost[0].monthly_cost),
                avgCostPerUnit: parseFloat(avgCost[0].avg_cost),
                costTrends: costTrends,
                costByCategory: costByCategory
            }
        });

    } catch (err) {
        console.error('❌ Error fetching cost analysis:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching cost analysis: ' + err.message
        });
    }
});

module.exports = router;