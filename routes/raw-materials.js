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

// GET raw materials main page - FIXED VERSION
router.get('/', getShopPrefix, async (req, res) => {
    try {
        // Check if this is an API call (from frontend JavaScript)
        const isApiCall = req.headers['content-type'] === 'application/json' || 
                         req.headers.accept?.includes('application/json') ||
                         req.xhr; // jQuery AJAX calls

        if (isApiCall) {
            // API CALL - Return JSON data
            console.log('📊 API Dashboard call detected');
            
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
            // BROWSER REQUEST - Render HTML page
            console.log('🌐 Browser page request detected');
            
            // Get minimal data for initial page load
            const [materialCount] = await pool.execute(
                `SELECT COUNT(*) as total FROM ${req.tablePrefix}raw_materials WHERE is_active = TRUE`
            );

            const [supplierCount] = await pool.execute(
                `SELECT COUNT(*) as total FROM ${req.tablePrefix}suppliers WHERE is_active = TRUE`
            );

            res.render('raw-materials/index', {
                title: 'Raw Product Management',
                shop: req.shop,
                dashboardStats: {
                    totalMaterials: materialCount[0].total,
                    lowStockCount: 0, // Will be loaded via API
                    criticalStockCount: 0, // Will be loaded via API
                    supplierCount: supplierCount[0].total
                },
                recentMovements: [],
                criticalAlerts: []
            });
        }
    } catch (err) {
        console.error('Error loading raw materials dashboard:', err);
        
        // Check if it's an API call for error response too
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
             LEFT JOIN ${req.tablePrefix}suppliers s ON rm.supplier_id = s.id
             ${whereClause}
             ORDER BY rm.name
             LIMIT ? OFFSET ?`,
            [...queryParams, limit, offset]
        );

        // Get total count for pagination
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total 
             FROM ${req.tablePrefix}raw_materials rm
             LEFT JOIN ${req.tablePrefix}suppliers s ON rm.supplier_id = s.id
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

// POST create new raw material
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

        await pool.execute(
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
                req.session.userId
            ]
        );

        res.json({
            success: true,
            message: 'Raw material added successfully'
        });
    } catch (err) {
        console.error('Error creating raw material:', err);
        res.status(500).json({
            success: false,
            message: 'Error creating raw material'
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
             FROM ${req.tablePrefix}suppliers s
             LEFT JOIN ${req.tablePrefix}raw_materials rm ON s.id = rm.supplier_id
             ${whereClause}
             GROUP BY s.id
             ORDER BY s.name
             LIMIT ? OFFSET ?`,
            [...queryParams, limit, offset]
        );

        // Get total count for pagination
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM ${req.tablePrefix}suppliers s ${whereClause}`,
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
            `INSERT INTO ${req.tablePrefix}suppliers 
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
                req.session.userId
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
            [req.session.userId, alertId]
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
            [req.session.userId]
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
                req.session.userId
            ]
        );

        // Update material stock level
        const materialUpdateQuery = movement_type === 'in' 
            ? `UPDATE ${req.tablePrefix}raw_materials SET current_stock = current_stock + ? WHERE id = ?`
            : `UPDATE ${req.tablePrefix}raw_materials SET current_stock = current_stock - ? WHERE id = ?`;

        await pool.execute(materialUpdateQuery, [parseFloat(quantity), raw_material_id]);

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

// GET cost analysis data
router.get('/cost-analysis', getShopPrefix, async (req, res) => {
    try {
        const { period, material_id, supplier_id, start_date, end_date } = req.query;

        // Calculate date range based on period
        let dateRange = '';
        const queryParams = [];

        if (start_date && end_date) {
            dateRange = 'AND sm.movement_date BETWEEN ? AND ?';
            queryParams.push(start_date, end_date);
        } else {
            // Default to last 12 months
            dateRange = 'AND sm.movement_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)';
        }

        // Total inventory value
        const [inventoryValue] = await pool.execute(
            `SELECT COALESCE(SUM(rm.current_stock * rm.cost_price), 0) as total_value
             FROM ${req.tablePrefix}raw_materials rm
             WHERE rm.is_active = TRUE`
        );

        // Monthly material cost
        const [monthlyCost] = await pool.execute(
            `SELECT COALESCE(SUM(sm.total_cost), 0) as monthly_cost
             FROM ${req.tablePrefix}raw_material_stock_movements sm
             WHERE sm.movement_type = 'in' 
             AND YEAR(sm.movement_date) = YEAR(CURDATE()) 
             AND MONTH(sm.movement_date) = MONTH(CURDATE())`
        );

        // Average cost per unit
        const [avgCost] = await pool.execute(
            `SELECT 
                COALESCE(AVG(rm.cost_price), 0) as avg_cost,
                COUNT(*) as material_count
             FROM ${req.tablePrefix}raw_materials rm
             WHERE rm.is_active = TRUE`
        );

        // Cost trends by period
        let groupBy = '';
        switch (period) {
            case 'monthly':
                groupBy = 'DATE_FORMAT(sm.movement_date, "%Y-%m")';
                break;
            case 'quarterly':
                groupBy = 'CONCAT(YEAR(sm.movement_date), "-Q", QUARTER(sm.movement_date))';
                break;
            case 'yearly':
            default:
                groupBy = 'YEAR(sm.movement_date)';
                break;
        }

        const [costTrends] = await pool.execute(
            `SELECT 
                ${groupBy} as period,
                SUM(sm.total_cost) as total_cost
             FROM ${req.tablePrefix}raw_material_stock_movements sm
             WHERE sm.movement_type = 'in' ${dateRange}
             GROUP BY ${groupBy}
             ORDER BY period`
        );

        // Cost by category
        const [costByCategory] = await pool.execute(
            `SELECT 
                rm.category,
                SUM(rm.current_stock * rm.cost_price) as inventory_value,
                COUNT(*) as material_count
             FROM ${req.tablePrefix}raw_materials rm
             WHERE rm.is_active = TRUE AND rm.category IS NOT NULL
             GROUP BY rm.category
             ORDER BY inventory_value DESC`
        );

        res.json({
            success: true,
            data: {
                inventoryValue: inventoryValue[0].total_value,
                monthlyCost: monthlyCost[0].monthly_cost,
                avgCostPerUnit: avgCost[0].avg_cost,
                costTrends,
                costByCategory
            }
        });
    } catch (err) {
        console.error('Error fetching cost analysis:', err);
        res.status(500).json({
            success: false,
            message: 'Error fetching cost analysis'
        });
    }
});

module.exports = router;