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

// GET main raw materials page
router.get('/', getShopInfo, async (req, res) => {
    try {
        const isApiCall = req.headers['content-type'] === 'application/json' ||
            req.headers.accept?.includes('application/json') ||
            req.xhr;

        if (isApiCall) {
            // Get dashboard statistics
            const [materialCount] = await pool.execute(
                `SELECT COUNT(*) as total FROM raw_materials 
                 WHERE shop_id = UUID_TO_BIN(?) AND is_active = TRUE`,
                [req.shopId]
            );

            const [lowStockCount] = await pool.execute(
                `SELECT COUNT(*) as total FROM raw_materials 
                 WHERE shop_id = UUID_TO_BIN(?) AND is_active = TRUE 
                 AND current_stock <= min_stock_level AND current_stock > 0`,
                [req.shopId]
            );

            const [criticalStockCount] = await pool.execute(
                `SELECT COUNT(*) as total FROM raw_materials 
                 WHERE shop_id = UUID_TO_BIN(?) AND is_active = TRUE 
                 AND current_stock = 0`,
                [req.shopId]
            );

            // Get total batches count for the month
            const [batchesCount] = await pool.execute(
                `SELECT COUNT(*) as total FROM raw_material_stock_movements 
                 WHERE shop_id = UUID_TO_BIN(?) 
                 AND YEAR(movement_date) = YEAR(CURDATE()) 
                 AND MONTH(movement_date) = MONTH(CURDATE())`,
                [req.shopId]
            );

            // Get real-time stock alerts
            const [materialsForAlerts] = await pool.execute(
                `SELECT 
                    BIN_TO_UUID(id) as id,
                    name,
                    current_stock,
                    min_stock_level,
                    max_stock_level
                 FROM raw_materials 
                 WHERE shop_id = UUID_TO_BIN(?) AND is_active = TRUE`,
                [req.shopId]
            );

            const alerts = [];
            materialsForAlerts.forEach(material => {
                if (material.current_stock === 0) {
                    alerts.push({
                        material_id: material.id,
                        material_name: material.name,
                        alert_type: 'critical_stock',
                        alert_message: `${material.name} is out of stock`,
                        current_value: 0,
                        threshold_value: material.min_stock_level || 0,
                        priority: 'high'
                    });
                } else if (material.min_stock_level > 0 && material.current_stock <= material.min_stock_level) {
                    alerts.push({
                        material_id: material.id,
                        material_name: material.name,
                        alert_type: 'low_stock',
                        alert_message: `${material.name} is running low on stock (${material.current_stock} left, min: ${material.min_stock_level})`,
                        current_value: material.current_stock,
                        threshold_value: material.min_stock_level,
                        priority: 'medium'
                    });
                }
            });

            return res.json({
                success: true,
                dashboardStats: {
                    totalMaterials: materialCount[0].total,
                    lowStockCount: lowStockCount[0].total,
                    criticalStockCount: criticalStockCount[0].total,
                    totalBatches: batchesCount[0].total
                },
                realTimeAlerts: alerts
            });
        } else {
            // Render the page
            res.render('raw-materials/index', {
                title: 'Raw Materials Management',
                shop: req.shop
            });
        }
    } catch (err) {
        console.error('Error loading raw materials dashboard:', err);
        res.status(500).json({
            success: false,
            message: 'An error occurred while loading dashboard data'
        });
    }
});

// GET raw materials data (for table)
router.get('/materials', getShopInfo, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const { search, category, status, stock_status, unit } = req.query;

        let whereClause = 'WHERE rm.shop_id = UUID_TO_BIN(?)';
        const queryParams = [req.shopId];

        if (search) {
            whereClause += ' AND (rm.name LIKE ? OR rm.sku LIKE ? OR rm.barcode LIKE ?)';
            queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (category && category !== 'all') {
            whereClause += ' AND rm.category = ?';
            queryParams.push(category);
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

        if (unit && unit !== 'all') {
            whereClause += ' AND rm.unit_of_measure = ?';
            queryParams.push(unit);
        }

        // Get materials
        const [materials] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(rm.id) as id,
                rm.name,
                rm.sku,
                rm.barcode,
                rm.category,
                rm.description,
                rm.unit_of_measure,
                rm.current_stock,
                rm.min_stock_level,
                rm.max_stock_level,
                rm.cost_price,
                rm.batch_tracking,
                rm.expiry_tracking,
                rm.is_active,
                rm.created_at,
                rm.updated_at,
                CASE 
                    WHEN rm.current_stock = 0 THEN 'critical'
                    WHEN rm.min_stock_level > 0 AND rm.current_stock <= rm.min_stock_level THEN 'low'
                    WHEN rm.max_stock_level > 0 AND rm.current_stock > rm.max_stock_level THEN 'over'
                    ELSE 'normal'
                END as stock_status
             FROM raw_materials rm
             ${whereClause}
             ORDER BY rm.name
             LIMIT ? OFFSET ?`,
            [...queryParams, limit, offset]
        );

        // Get total count for pagination
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM raw_materials rm ${whereClause}`,
            queryParams
        );
        const total = countResult[0].total;

        // Get unique categories for filters
        const [categories] = await pool.execute(
            `SELECT DISTINCT category FROM raw_materials 
             WHERE shop_id = UUID_TO_BIN(?) AND category IS NOT NULL 
             ORDER BY category`,
            [req.shopId]
        );

        // Get unique units for filters
        const [units] = await pool.execute(
            `SELECT DISTINCT unit_of_measure FROM raw_materials 
             WHERE shop_id = UUID_TO_BIN(?) AND unit_of_measure IS NOT NULL 
             ORDER BY unit_of_measure`,
            [req.shopId]
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
                units: units.map(u => u.unit_of_measure)
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

// POST create new raw material (without price/quantity - only basic info)
router.post('/materials', getShopInfo, async (req, res) => {
    try {
        const {
            name,
            sku,
            barcode,
            category,
            description,
            unit_of_measure,
            min_stock_level,
            max_stock_level,
            batch_tracking,
            expiry_tracking,
            is_active
        } = req.body;

        // Validation
        if (!name || !unit_of_measure) {
            return res.status(400).json({
                success: false,
                message: 'Name and unit of measure are required'
            });
        }

        // Insert raw material without cost_price or current_stock
        const [result] = await pool.execute(
            `INSERT INTO raw_materials 
             (id, shop_id, name, sku, barcode, category, description, unit_of_measure, 
              current_stock, min_stock_level, max_stock_level, cost_price,
              batch_tracking, expiry_tracking, is_active, created_by, created_at)
             VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, UUID_TO_BIN(?), NOW())`,
            [
                req.shopId,
                name,
                sku || null,
                barcode || null,
                category || null,
                description || null,
                unit_of_measure,
                parseFloat(min_stock_level) || 0,
                parseFloat(max_stock_level) || 0,
                batch_tracking === true || batch_tracking === 'true',
                expiry_tracking === true || expiry_tracking === 'true',
                is_active === true || is_active === 'true' || true,
                req.session.userId
            ]
        );

        const [newMaterial] = await pool.execute(
            'SELECT BIN_TO_UUID(id) as id FROM raw_materials WHERE id = LAST_INSERT_ID()'
        );
        const materialId = newMaterial[0].id;

        res.json({
            success: true,
            message: 'Raw material added successfully',
            materialId: materialId
        });

    } catch (err) {
        console.error('Error creating raw material:', err);
        res.status(500).json({
            success: false,
            message: 'Error creating raw material: ' + err.message
        });
    }
});

// POST create multiple raw materials at once
router.post('/materials/bulk', getShopInfo, async (req, res) => {
    try {
        const materials = req.body.materials;

        if (!Array.isArray(materials) || materials.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Materials array is required'
            });
        }

        // Validate each material
        for (const material of materials) {
            if (!material.name || !material.unit_of_measure) {
                return res.status(400).json({
                    success: false,
                    message: 'Each material must have name and unit of measure'
                });
            }
        }

        const insertedIds = [];

        // Insert each material
        for (const material of materials) {
            const [result] = await pool.execute(
                `INSERT INTO raw_materials 
                 (id, shop_id, name, sku, barcode, category, description, unit_of_measure, 
                  current_stock, min_stock_level, max_stock_level, cost_price,
                  batch_tracking, expiry_tracking, is_active, created_by, created_at)
                 VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, UUID_TO_BIN(?), NOW())`,
                [
                    req.shopId,
                    material.name,
                    material.sku || null,
                    material.barcode || null,
                    material.category || null,
                    material.description || null,
                    material.unit_of_measure,
                    parseFloat(material.min_stock_level) || 0,
                    parseFloat(material.max_stock_level) || 0,
                    material.batch_tracking === true || material.batch_tracking === 'true',
                    material.expiry_tracking === true || material.expiry_tracking === 'true',
                    material.is_active !== false,
                    req.session.userId
                ]
            );

            const [newMaterial] = await pool.execute(
                'SELECT BIN_TO_UUID(id) as id FROM raw_materials WHERE id = LAST_INSERT_ID()'
            );
            insertedIds.push(newMaterial[0].id);
        }

        res.json({
            success: true,
            message: `Successfully added ${materials.length} materials`,
            materialIds: insertedIds
        });

    } catch (err) {
        console.error('Error creating bulk materials:', err);
        res.status(500).json({
            success: false,
            message: 'Error creating materials: ' + err.message
        });
    }
});

// GET single material for editing
router.get('/materials/:id', getShopInfo, async (req, res) => {
    try {
        const materialId = req.params.id;

        const [materials] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(id) as id,
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
                batch_tracking,
                expiry_tracking,
                is_active
             FROM raw_materials 
             WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [materialId, req.shopId]
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
router.put('/materials/:id', getShopInfo, async (req, res) => {
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
            batch_tracking,
            expiry_tracking,
            is_active
        } = req.body;

        // Validation
        if (!name || !unit_of_measure) {
            return res.status(400).json({
                success: false,
                message: 'Name and unit of measure are required'
            });
        }

        // Check if material exists
        const [existingMaterials] = await pool.execute(
            `SELECT id FROM raw_materials WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [materialId, req.shopId]
        );

        if (existingMaterials.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Material not found'
            });
        }

        // Update material (cost_price is not updated here)
        await pool.execute(
            `UPDATE raw_materials 
             SET name = ?, sku = ?, barcode = ?, category = ?, description = ?, 
                 unit_of_measure = ?, min_stock_level = ?, max_stock_level = ?, 
                 batch_tracking = ?, expiry_tracking = ?,
                 is_active = ?, updated_at = NOW()
             WHERE id = UUID_TO_BIN(?)`,
            [
                name,
                sku || null,
                barcode || null,
                category || null,
                description || null,
                unit_of_measure,
                parseFloat(min_stock_level) || 0,
                parseFloat(max_stock_level) || 0,
                batch_tracking === true || batch_tracking === 'true',
                expiry_tracking === true || expiry_tracking === 'true',
                is_active === true || is_active === 'true',
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
router.delete('/materials/:id', getShopInfo, async (req, res) => {
    try {
        const materialId = req.params.id;

        // Check if material exists
        const [existingMaterials] = await pool.execute(
            `SELECT name FROM raw_materials WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [materialId, req.shopId]
        );

        if (existingMaterials.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Material not found'
            });
        }

        const materialName = existingMaterials[0].name;

        // Check if material has any stock
        const [materialStock] = await pool.execute(
            `SELECT current_stock FROM raw_materials WHERE id = UUID_TO_BIN(?)`,
            [materialId]
        );

        // Only allow deletion if stock is zero
        if (materialStock[0].current_stock > 0) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete material with existing stock. Please use all stock first.'
            });
        }

        // Check if material has any stock movements
        const [movements] = await pool.execute(
            `SELECT COUNT(*) as movement_count FROM raw_material_stock_movements 
             WHERE raw_material_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [materialId, req.shopId]
        );

        const hasMovements = movements[0].movement_count > 0;

        if (hasMovements) {
            // Soft delete - set is_active to false
            await pool.execute(
                `UPDATE raw_materials 
                 SET is_active = FALSE, updated_at = NOW()
                 WHERE id = UUID_TO_BIN(?)`,
                [materialId]
            );
        } else {
            // Hard delete if no movements
            await pool.execute(
                `DELETE FROM raw_materials 
                 WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
                [materialId, req.shopId]
            );
        }

        res.json({
            success: true,
            message: 'Material deleted successfully',
            materialName: materialName,
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

// Add this route after your other routes in the controller
// GET stock ledger for a specific material
router.get('/materials/:id/ledger', getShopInfo, async (req, res) => {
    try {
        const materialId = req.params.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        // Check if material exists and belongs to shop
        const [material] = await pool.execute(
            `SELECT name FROM raw_materials 
             WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [materialId, req.shopId]
        );

        if (material.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Material not found'
            });
        }

        // Get stock ledger (movements) for this material
        const [ledger] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(sm.id) as id,
                sm.movement_type,
                sm.quantity,
                sm.unit_cost,
                sm.total_cost,
                sm.reference_type,
                sm.reference_id,
                sm.notes,
                sm.movement_date,
                sm.batch_number,
                sm.expiry_date,
                s.name as supplier_name,
                sm.created_at,
                CASE 
                    WHEN sm.movement_type = 'in' THEN 'positive'
                    WHEN sm.movement_type = 'out' THEN 'negative'
                    ELSE 'neutral'
                END as impact
             FROM raw_material_stock_movements sm
             LEFT JOIN suppliers s ON sm.supplier_id = s.id
             WHERE sm.raw_material_id = UUID_TO_BIN(?) AND sm.shop_id = UUID_TO_BIN(?)
             ORDER BY sm.movement_date DESC, sm.created_at DESC
             LIMIT ? OFFSET ?`,
            [materialId, req.shopId, limit, offset]
        );

        // Get total count for pagination
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM raw_material_stock_movements 
             WHERE raw_material_id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [materialId, req.shopId]
        );
        const total = countResult[0].total;

        // Get material summary
        const [summary] = await pool.execute(
            `SELECT 
                current_stock,
                cost_price,
                unit_of_measure,
                SUM(CASE WHEN movement_type = 'in' THEN quantity ELSE 0 END) as total_in,
                SUM(CASE WHEN movement_type = 'out' THEN quantity ELSE 0 END) as total_out,
                SUM(CASE WHEN movement_type = 'in' THEN total_cost ELSE 0 END) as total_in_value,
                SUM(CASE WHEN movement_type = 'out' THEN total_cost ELSE 0 END) as total_out_value
             FROM raw_materials rm
             LEFT JOIN raw_material_stock_movements sm ON rm.id = sm.raw_material_id
             WHERE rm.id = UUID_TO_BIN(?) AND rm.shop_id = UUID_TO_BIN(?)
             GROUP BY rm.id`,
            [materialId, req.shopId]
        );

        res.json({
            success: true,
            data: {
                material: material[0],
                ledger: ledger,
                summary: summary[0] || {
                    current_stock: 0,
                    cost_price: 0,
                    total_in: 0,
                    total_out: 0,
                    total_in_value: 0,
                    total_out_value: 0
                }
            },
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Error fetching stock ledger:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching stock ledger'
        });
    }
});

// GET stock movements (batches)
router.get('/batches', getShopInfo, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const { search, material_id, reference_type, movement_type } = req.query;

        let whereClause = 'WHERE sm.shop_id = UUID_TO_BIN(?)';
        const queryParams = [req.shopId];

        if (search) {
            whereClause += ' AND (sm.batch_number LIKE ? OR sm.reference_id LIKE ? OR rm.name LIKE ?)';
            queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (material_id && material_id !== 'all') {
            whereClause += ' AND sm.raw_material_id = UUID_TO_BIN(?)';
            queryParams.push(material_id);
        }

        if (reference_type && reference_type !== 'all') {
            whereClause += ' AND sm.reference_type = ?';
            queryParams.push(reference_type);
        }

        if (movement_type && movement_type !== 'all') {
            whereClause += ' AND sm.movement_type = ?';
            queryParams.push(movement_type);
        }

        // Get stock movements with material information
        const [batches] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(sm.id) as id,
                sm.batch_number,
                sm.movement_type,
                sm.quantity,
                sm.unit_cost,
                sm.total_cost,
                sm.reference_type,
                sm.reference_id,
                sm.notes,
                sm.movement_date,
                sm.expiry_date,
                sm.supplier_id,
                sm.created_at,
                BIN_TO_UUID(rm.id) as raw_material_id,
                rm.name as material_name,
                rm.unit_of_measure,
                s.name as supplier_name
             FROM raw_material_stock_movements sm
             LEFT JOIN raw_materials rm ON sm.raw_material_id = rm.id
             LEFT JOIN suppliers s ON sm.supplier_id = s.id
             ${whereClause}
             ORDER BY sm.movement_date DESC, sm.created_at DESC
             LIMIT ? OFFSET ?`,
            [...queryParams, limit, offset]
        );

        // Get total count for pagination
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM raw_material_stock_movements sm ${whereClause}`,
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

// POST create stock movement (with supplier and ledger updates)
router.post('/batches', getShopInfo, async (req, res) => {
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
            expiry_date,
            supplier_id
        } = req.body;

        // Validation
        if (!raw_material_id || !movement_type || !quantity || !movement_date || !unit_cost) {
            return res.status(400).json({
                success: false,
                message: 'Material, movement type, quantity, unit cost, and date are required'
            });
        }

        if (movement_type === 'in' && !supplier_id) {
            return res.status(400).json({
                success: false,
                message: 'Supplier is required for stock in movements'
            });
        }

        const total_cost = parseFloat(quantity) * parseFloat(unit_cost);

        // Start transaction
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // Get current cost price and stock for the material
            const [materialInfo] = await connection.execute(
                `SELECT cost_price, current_stock FROM raw_materials WHERE id = UUID_TO_BIN(?)`,
                [raw_material_id]
            );

            let newCostPrice = parseFloat(unit_cost);
            if (materialInfo.length > 0 && materialInfo[0].current_stock > 0) {
                // Weighted average cost calculation
                const currentValue = materialInfo[0].cost_price * materialInfo[0].current_stock;
                const newValue = total_cost;
                const newTotalStock = materialInfo[0].current_stock + parseFloat(quantity);
                newCostPrice = (currentValue + newValue) / newTotalStock;
            }

            // Insert stock movement
            await connection.execute(
                `INSERT INTO raw_material_stock_movements 
                 (id, shop_id, raw_material_id, batch_number, movement_type, quantity, 
                  unit_cost, total_cost, reference_type, reference_id, notes, movement_date, expiry_date, supplier_id, created_by, created_at)
                 VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UUID_TO_BIN(?), UUID_TO_BIN(?), NOW())`,
                [
                    req.shopId,
                    raw_material_id,
                    batch_number || null,
                    movement_type,
                    parseFloat(quantity),
                    parseFloat(unit_cost),
                    total_cost,
                    reference_type || 'purchase',
                    reference_id || null,
                    notes || null,
                    movement_date,
                    expiry_date || null,
                    supplier_id || null,
                    req.session.userId
                ]
            );

            // Update material stock level and cost price
            if (movement_type === 'in') {
                await connection.execute(
                    `UPDATE raw_materials 
                     SET current_stock = current_stock + ?, cost_price = ?, updated_at = NOW()
                     WHERE id = UUID_TO_BIN(?)`,
                    [parseFloat(quantity), newCostPrice, raw_material_id]
                );

                // Update supplier balance and create transaction
                if (supplier_id) {
                    // Create supplier transaction (debit - we owe money)
                    await connection.execute(
                        `INSERT INTO supplier_transactions 
                         (id, shop_id, supplier_id, type, amount, description, reference_type, reference_id, created_by, created_at)
                         VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), 'debit', ?, ?, 'stock_in', LAST_INSERT_ID(), UUID_TO_BIN(?), NOW())`,
                        [
                            req.shopId,
                            supplier_id,
                            total_cost,
                            `Raw material purchase: ${batch_number || 'No batch'}`,
                            req.session.userId
                        ]
                    );

                    // Update supplier balance
                    await connection.execute(
                        `INSERT INTO supplier_balance (shop_id, supplier_id, total_debit, total_credit)
                         VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), ?, 0)
                         ON DUPLICATE KEY UPDATE 
                         total_debit = total_debit + VALUES(total_debit),
                         updated_at = NOW()`,
                        [req.shopId, supplier_id, total_cost]
                    );
                }
            } else {
                // For stock out or adjustment
                await connection.execute(
                    `UPDATE raw_materials 
                     SET current_stock = current_stock - ?, updated_at = NOW()
                     WHERE id = UUID_TO_BIN(?)`,
                    [parseFloat(quantity), raw_material_id]
                );
            }

            await connection.commit();
            connection.release();

            res.json({
                success: true,
                message: 'Stock movement recorded successfully',
                newCostPrice: newCostPrice
            });
        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        }
    } catch (err) {
        console.error('Error creating stock movement:', err);
        res.status(500).json({
            success: false,
            message: 'Error creating stock movement: ' + err.message
        });
    }
});

// GET suppliers for dropdown
router.get('/suppliers', getShopInfo, async (req, res) => {
    try {
        const [suppliers] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(id) as id,
                name,
                phone,
                email,
                (SELECT balance FROM supplier_balance WHERE supplier_id = suppliers.id AND shop_id = UUID_TO_BIN(?) LIMIT 1) as balance
             FROM suppliers 
             WHERE shop_id = UUID_TO_BIN(?) AND status = 'active'
             ORDER BY name`,
            [req.shopId, req.shopId]
        );

        res.json({
            success: true,
            data: suppliers
        });
    } catch (err) {
        console.error('Error fetching suppliers:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching suppliers'
        });
    }
});

// GET single batch for editing
router.get('/batches/:id', getShopInfo, async (req, res) => {
    try {
        const batchId = req.params.id;

        const [batches] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(sm.id) as id,
                BIN_TO_UUID(sm.raw_material_id) as raw_material_id,
                sm.batch_number,
                sm.movement_type,
                sm.quantity,
                sm.unit_cost,
                sm.total_cost,
                sm.reference_type,
                sm.reference_id,
                sm.notes,
                sm.movement_date,
                sm.expiry_date,
                BIN_TO_UUID(sm.supplier_id) as supplier_id,
                rm.name as material_name,
                rm.unit_of_measure,
                s.name as supplier_name
             FROM raw_material_stock_movements sm
             LEFT JOIN raw_materials rm ON sm.raw_material_id = rm.id
             LEFT JOIN suppliers s ON sm.supplier_id = s.id
             WHERE sm.id = UUID_TO_BIN(?) AND sm.shop_id = UUID_TO_BIN(?)`,
            [batchId, req.shopId]
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
router.put('/batches/:id', getShopInfo, async (req, res) => {
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
            expiry_date,
            supplier_id
        } = req.body;

        // Validation
        if (!raw_material_id || !movement_type || !quantity || !movement_date || !unit_cost) {
            return res.status(400).json({
                success: false,
                message: 'Material, movement type, quantity, unit cost, and date are required'
            });
        }

        // Check if batch exists
        const [existingBatches] = await pool.execute(
            `SELECT * FROM raw_material_stock_movements 
             WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [batchId, req.shopId]
        );

        if (existingBatches.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Batch not found'
            });
        }

        const oldBatch = existingBatches[0];
        const total_cost = parseFloat(quantity) * parseFloat(unit_cost);

        // Start transaction
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // First, reverse the old stock movement
            const reverseQuery = oldBatch.movement_type === 'in'
                ? `UPDATE raw_materials SET current_stock = current_stock - ?, cost_price = ? WHERE id = ?`
                : `UPDATE raw_materials SET current_stock = current_stock + ? WHERE id = ?`;

            // For stock in reversal, we need to recalculate cost price
            if (oldBatch.movement_type === 'in') {
                const [materialInfo] = await connection.execute(
                    `SELECT cost_price, current_stock FROM raw_materials WHERE id = ?`,
                    [oldBatch.raw_material_id]
                );

                let newCostPrice = oldBatch.unit_cost;
                if (materialInfo.length > 0 && materialInfo[0].current_stock > oldBatch.quantity) {
                    const currentValue = materialInfo[0].cost_price * materialInfo[0].current_stock;
                    const oldValue = oldBatch.total_cost;
                    const newTotalStock = materialInfo[0].current_stock - oldBatch.quantity;
                    newCostPrice = newTotalStock > 0 ? (currentValue - oldValue) / newTotalStock : 0;
                }

                await connection.execute(reverseQuery, [oldBatch.quantity, newCostPrice, oldBatch.raw_material_id]);

                // Reverse supplier transaction if old movement was stock in
                if (oldBatch.supplier_id) {
                    await connection.execute(
                        `DELETE FROM supplier_transactions 
                         WHERE reference_type = 'stock_in' AND reference_id = UUID_TO_BIN(?)`,
                        [batchId]
                    );

                    await connection.execute(
                        `UPDATE supplier_balance 
                         SET total_debit = total_debit - ?, updated_at = NOW()
                         WHERE supplier_id = ? AND shop_id = UUID_TO_BIN(?)`,
                        [oldBatch.total_cost, oldBatch.supplier_id, req.shopId]
                    );
                }
            } else {
                await connection.execute(reverseQuery, [oldBatch.quantity, oldBatch.raw_material_id]);
            }

            // Update the batch record
            await connection.execute(
                `UPDATE raw_material_stock_movements 
                 SET raw_material_id = UUID_TO_BIN(?), batch_number = ?, movement_type = ?, quantity = ?, 
                     unit_cost = ?, total_cost = ?, reference_type = ?, reference_id = ?, 
                     notes = ?, movement_date = ?, expiry_date = ?, supplier_id = UUID_TO_BIN(?)
                 WHERE id = UUID_TO_BIN(?)`,
                [
                    raw_material_id,
                    batch_number || null,
                    movement_type,
                    parseFloat(quantity),
                    parseFloat(unit_cost),
                    total_cost,
                    reference_type || 'purchase',
                    reference_id || null,
                    notes || null,
                    movement_date,
                    expiry_date || null,
                    supplier_id || null,
                    batchId
                ]
            );

            // Apply the new stock movement
            if (movement_type === 'in') {
                // Get material info for new cost price calculation
                const [materialInfo] = await connection.execute(
                    `SELECT cost_price, current_stock FROM raw_materials WHERE id = UUID_TO_BIN(?)`,
                    [raw_material_id]
                );

                let newCostPrice = parseFloat(unit_cost);
                if (materialInfo.length > 0 && materialInfo[0].current_stock > 0) {
                    const currentValue = materialInfo[0].cost_price * materialInfo[0].current_stock;
                    const newValue = total_cost;
                    const newTotalStock = materialInfo[0].current_stock + parseFloat(quantity);
                    newCostPrice = (currentValue + newValue) / newTotalStock;                }

                await connection.execute(
                    `UPDATE raw_materials 
                     SET current_stock = current_stock + ?, cost_price = ?, updated_at = NOW()
                     WHERE id = UUID_TO_BIN(?)`,
                    [parseFloat(quantity), newCostPrice, raw_material_id]
                );

                // Update supplier balance and create transaction
                if (supplier_id) {
                    await connection.execute(
                        `INSERT INTO supplier_transactions 
                         (id, shop_id, supplier_id, type, amount, description, reference_type, reference_id, created_by, created_at)
                         VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(?), UUID_TO_BIN(?), 'debit', ?, ?, 'stock_in', UUID_TO_BIN(?), UUID_TO_BIN(?), NOW())`,
                        [
                            req.shopId,
                            supplier_id,
                            total_cost,
                            `Raw material purchase: ${batch_number || 'No batch'}`,
                            batchId,
                            req.session.userId
                        ]
                    );

                    await connection.execute(
                        `INSERT INTO supplier_balance (shop_id, supplier_id, total_debit, total_credit)
                         VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), ?, 0)
                         ON DUPLICATE KEY UPDATE 
                         total_debit = total_debit + VALUES(total_debit),
                         updated_at = NOW()`,
                        [req.shopId, supplier_id, total_cost]
                    );
                }
            } else {
                // For stock out or adjustment
                await connection.execute(
                    `UPDATE raw_materials 
                     SET current_stock = current_stock - ?, updated_at = NOW()
                     WHERE id = UUID_TO_BIN(?)`,
                    [parseFloat(quantity), raw_material_id]
                );
            }

            await connection.commit();
            connection.release();

            res.json({
                success: true,
                message: 'Batch updated successfully'
            });
        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
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
router.delete('/batches/:id', getShopInfo, async (req, res) => {
    try {
        const batchId = req.params.id;

        // Check if batch exists
        const [existingBatches] = await pool.execute(
            `SELECT * FROM raw_material_stock_movements 
             WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [batchId, req.shopId]
        );

        if (existingBatches.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Batch not found'
            });
        }

        const batch = existingBatches[0];
        const materialId = batch.raw_material_id;

        // Start transaction
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // Reverse the stock movement
            if (batch.movement_type === 'in') {
                // For stock in reversal, need to recalculate cost price
                const [materialInfo] = await connection.execute(
                    `SELECT cost_price, current_stock FROM raw_materials WHERE id = ?`,
                    [materialId]
                );

                let newCostPrice = batch.unit_cost;
                if (materialInfo.length > 0 && materialInfo[0].current_stock > batch.quantity) {
                    const currentValue = materialInfo[0].cost_price * materialInfo[0].current_stock;
                    const batchValue = batch.total_cost;
                    const newTotalStock = materialInfo[0].current_stock - batch.quantity;
                    newCostPrice = newTotalStock > 0 ? (currentValue - batchValue) / newTotalStock : 0;
                }

                await connection.execute(
                    `UPDATE raw_materials 
                     SET current_stock = current_stock - ?, cost_price = ?, updated_at = NOW()
                     WHERE id = ?`,
                    [batch.quantity, newCostPrice, materialId]
                );

                // Reverse supplier transaction
                if (batch.supplier_id) {
                    await connection.execute(
                        `DELETE FROM supplier_transactions 
                         WHERE reference_type = 'stock_in' AND reference_id = UUID_TO_BIN(?)`,
                        [batchId]
                    );

                    await connection.execute(
                        `UPDATE supplier_balance 
                         SET total_debit = total_debit - ?, updated_at = NOW()
                         WHERE supplier_id = ? AND shop_id = UUID_TO_BIN(?)`,
                        [batch.total_cost, batch.supplier_id, req.shopId]
                    );
                }
            } else {
                await connection.execute(
                    `UPDATE raw_materials 
                     SET current_stock = current_stock + ?, updated_at = NOW()
                     WHERE id = ?`,
                    [batch.quantity, materialId]
                );
            }

            // Delete the batch record
            await connection.execute(
                `DELETE FROM raw_material_stock_movements WHERE id = UUID_TO_BIN(?)`,
                [batchId]
            );

            await connection.commit();
            connection.release();

            res.json({
                success: true,
                message: 'Batch deleted successfully'
            });
        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        }
    } catch (err) {
        console.error('Error deleting batch:', err);
        res.status(500).json({
            success: false,
            message: 'Error deleting batch: ' + err.message
        });
    }
});

// GET real-time stock alerts
router.get('/alerts/real-time', getShopInfo, async (req, res) => {
    try {
        const [materials] = await pool.execute(
            `SELECT 
                BIN_TO_UUID(id) as id,
                name,
                current_stock,
                min_stock_level,
                max_stock_level
             FROM raw_materials 
             WHERE shop_id = UUID_TO_BIN(?) AND is_active = TRUE`,
            [req.shopId]
        );

        const alerts = [];
        materials.forEach(material => {
            if (material.current_stock === 0) {
                alerts.push({
                    material_id: material.id,
                    material_name: material.name,
                    alert_type: 'critical_stock',
                    alert_message: `${material.name} is out of stock`,
                    current_value: 0,
                    threshold_value: material.min_stock_level || 0,
                    priority: 'high'
                });
            } else if (material.min_stock_level > 0 && material.current_stock <= material.min_stock_level) {
                alerts.push({
                    material_id: material.id,
                    material_name: material.name,
                    alert_type: 'low_stock',
                    alert_message: `${material.name} is running low on stock (${material.current_stock} left, min: ${material.min_stock_level})`,
                    current_value: material.current_stock,
                    threshold_value: material.min_stock_level,
                    priority: 'medium'
                });
            }
        });

        res.json({
            success: true,
            data: alerts,
            total: alerts.length
        });
    } catch (err) {
        console.error('Error fetching real-time alerts:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching alerts'
        });
    }
});

module.exports = router;