const express = require('express');
const router = express.Router();
const { pool } = require('../db');

const TABLES = {
    shops: {
        upload: false,
        shopScoped: false,
        uuidColumns: ['id'],
        columns: ['id', 'name', 'email', 'phone', 'address', 'logo', 'plan', 'currency', 'primary_color', 'secondary_color', 'status', 'created_at', 'updated_at'],
        where: 'id = UUID_TO_BIN(?)'
    },
    roles: {
        upload: false,
        shopScoped: false,
        uuidColumns: ['id'],
        columns: ['id', 'role_name', 'description', 'status', 'created_at', 'updated_at']
    },
    users: {
        upload: false,
        uuidColumns: ['id', 'shop_id', 'role_id'],
        columns: ['id', 'shop_id', 'role_id', 'name', 'email', 'phone', 'salary', 'loan', 'cnic', 'status', 'created_at', 'updated_at', 'notes', 'profile_picture']
    },
    products: {
        upload: true,
        uuidColumns: ['id', 'shop_id'],
        columns: ['id', 'shop_id', 'name', 'brand', 'category', 'size', 'sku', 'barcode', 'active', 'created_at', 'updated_at']
    },
    inventory: {
        upload: true,
        uuidColumns: ['id', 'shop_id', 'product_id'],
        columns: ['id', 'shop_id', 'product_id', 'current_quantity', 'avg_cost', 'updated_at']
    },
    stock_in: {
        upload: true,
        uuidColumns: ['id', 'shop_id', 'product_id', 'supplier_id', 'received_by'],
        columns: ['id', 'shop_id', 'product_id', 'batch_number', 'quantity', 'unit_price', 'buying_price', 'selling_price', 'total_buying_value', 'expiry_date', 'supplier_id', 'transaction_type', 'payment_amount', 'notes', 'received_by', 'created_at']
    },
    suppliers: {
        upload: true,
        uuidColumns: ['id', 'shop_id'],
        columns: ['id', 'shop_id', 'name', 'contact_person', 'email', 'phone', 'address', 'tax_number', 'payment_terms', 'type', 'status', 'account_number', 'bank_name', 'notes', 'city', 'country', 'created_at', 'updated_at']
    },
    customers: {
        upload: true,
        uuidColumns: ['id', 'shop_id'],
        columns: ['id', 'shop_id', 'name', 'phone', 'email', 'address', 'type', 'city', 'country', 'notes', 'reference', 'discount', 'credit_limit', 'created_at', 'updated_at']
    },
    bills: {
        upload: true,
        uuidColumns: ['id', 'shop_id', 'customer_id', 'created_by'],
        columns: ['id', 'shop_id', 'bill_number', 'customer_id', 'customer_name', 'customer_phone', 'subtotal', 'discount', 'tax', 'total_amount', 'paid_amount', 'due_amount', 'payment_method', 'notes', 'created_by', 'created_at']
    },
    bill_items: {
        upload: true,
        uuidColumns: ['id', 'shop_id', 'product_id', 'bill_id', 'sold_by'],
        columns: ['id', 'shop_id', 'product_id', 'batch_number', 'quantity', 'unit_price', 'total_price', 'bill_id', 'sold_by', 'created_at']
    },
    expenses: {
        upload: true,
        uuidColumns: ['id', 'shop_id', 'created_by'],
        columns: ['id', 'shop_id', 'category', 'description', 'amount', 'expense_date', 'payment_method', 'receipt_number', 'created_by', 'created_at', 'updated_at']
    },
    user_cash_submission: {
        upload: true,
        uuidColumns: ['id', 'shop_id', 'user_id'],
        columns: ['id', 'shop_id', 'user_id', 'submission_date', 'total_collected', 'submitted_amount', 'notes', 'created_at']
    }
};

const DOWNLOAD_TABLES = Object.keys(TABLES);

function requireSyncAuth(req, res, next) {
    if (!req.session?.userId || !req.session?.shopId) {
        return res.status(401).json({ error: 'Login required before sync' });
    }
    next();
}

async function loadSubscription(req, res, next) {
    try {
        const [rows] = await pool.execute(
            `SELECT sub.plan_name, sub.status, sub.expires_at, pp.features
             FROM subscriptions sub
             LEFT JOIN pricing_plans pp ON pp.name = sub.plan_name AND pp.status = 'active'
             WHERE sub.shop_id = UUID_TO_BIN(?)
             ORDER BY sub.expires_at DESC
             LIMIT 1`,
            [req.session.shopId]
        );

        if (!rows.length) {
            req.syncSubscription = {
                plan_name: 'Free',
                status: 'free',
                offlineAllowed: false,
                features: {}
            };
            return next();
        }

        const subscription = rows[0];
        const expiresAt = subscription.expires_at ? new Date(subscription.expires_at) : null;
        if (subscription.status !== 'active' || (expiresAt && expiresAt < new Date())) {
            return res.status(402).json({ error: 'Subscription expired or inactive' });
        }

        let features = {};
        try {
            features = subscription.features ? JSON.parse(subscription.features) : {};
        } catch {
            features = {};
        }

        const planName = String(subscription.plan_name || '').toLowerCase();
        req.syncSubscription = {
            ...subscription,
            features,
            offlineAllowed: features.offline_sync === true || features.desktop_offline === true || !planName.includes('free')
        };

        if (!req.syncSubscription.offlineAllowed) {
            return res.status(402).json({ error: 'Your current subscription does not include offline sync' });
        }

        next();
    } catch (error) {
        console.error('Sync subscription check error:', error);
        res.status(500).json({ error: 'Unable to verify subscription' });
    }
}

router.use(requireSyncAuth, loadSubscription);

router.get('/manifest', (req, res) => {
    res.json({
        shop_id: req.session.shopId,
        user_id: req.session.userId,
        subscription: {
            plan_name: req.syncSubscription.plan_name,
            status: req.syncSubscription.status,
            expires_at: req.syncSubscription.expires_at,
            offline_allowed: req.syncSubscription.offlineAllowed
        },
        tables: DOWNLOAD_TABLES
    });
});

router.get('/bootstrap', async (req, res) => {
    try {
        const payload = {};
        for (const table of DOWNLOAD_TABLES) {
            payload[table] = await fetchChanges(table, req.session.shopId, null);
        }
        res.json({
            shop_id: req.session.shopId,
            user_id: req.session.userId,
            downloaded_at: new Date().toISOString(),
            data: payload
        });
    } catch (error) {
        console.error('Sync bootstrap error:', error);
        res.status(500).json({ error: 'Unable to download offline data' });
    }
});

router.get('/:table/changes', async (req, res) => {
    try {
        const table = req.params.table;
        if (!TABLES[table]) {
            return res.status(400).json({ error: 'Invalid table name' });
        }

        const changes = await fetchChanges(table, req.session.shopId, req.query.since || null);
        res.json(changes);
    } catch (error) {
        console.error('Sync download error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/:table', async (req, res) => {
    try {
        const table = req.params.table;
        const config = TABLES[table];
        if (!config?.upload) {
            return res.status(400).json({ error: 'This table cannot be uploaded by sync' });
        }

        const data = normalizePayload(config, req.body, req.session.shopId, req.session.userId);
        await upsertRecord(table, config, data, req.session.shopId);
        res.status(201).json({ success: true, id: data.id });
    } catch (error) {
        console.error('Sync upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.put('/:table/:id', async (req, res) => {
    try {
        const table = req.params.table;
        const config = TABLES[table];
        if (!config?.upload) {
            return res.status(400).json({ error: 'This table cannot be uploaded by sync' });
        }

        const data = normalizePayload(config, { ...req.body, id: req.params.id }, req.session.shopId, req.session.userId);
        await updateRecord(table, config, data, req.params.id, req.session.shopId);
        res.json({ success: true, id: req.params.id });
    } catch (error) {
        console.error('Sync update error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/:table/:id', async (req, res) => {
    try {
        const table = req.params.table;
        const config = TABLES[table];
        if (!config?.upload) {
            return res.status(400).json({ error: 'This table cannot be deleted by sync' });
        }

        const [result] = await pool.execute(
            `DELETE FROM ${table} WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
            [req.params.id, req.session.shopId]
        );
        res.json({ success: true, affectedRows: result.affectedRows });
    } catch (error) {
        console.error('Sync delete error:', error);
        res.status(500).json({ error: error.message });
    }
});

async function fetchChanges(table, shopId, since) {
    const config = TABLES[table];
    const selectColumns = config.columns.map((column) => {
        if (config.uuidColumns.includes(column)) {
            return `BIN_TO_UUID(${column}) AS ${column}`;
        }
        return column;
    });

    let query = `SELECT ${selectColumns.join(', ')} FROM ${table}`;
    const params = [];
    const where = [];

    if (table === 'shops') {
        where.push(config.where);
        params.push(shopId);
    } else if (config.shopScoped !== false && config.columns.includes('shop_id')) {
        where.push('shop_id = UUID_TO_BIN(?)');
        params.push(shopId);
    }

    if (since && config.columns.includes('updated_at')) {
        where.push('updated_at > ?');
        params.push(since);
    }

    if (where.length) {
        query += ` WHERE ${where.join(' AND ')}`;
    }

    const orderColumn = config.columns.includes('updated_at') ? 'updated_at' : 'created_at';
    if (config.columns.includes(orderColumn)) {
        query += ` ORDER BY ${orderColumn} ASC`;
    }

    const [rows] = await pool.execute(query, params);
    return rows;
}

function normalizePayload(config, payload, shopId, userId) {
    const data = {};
    for (const column of config.columns) {
        if (Object.prototype.hasOwnProperty.call(payload, column)) {
            data[column] = payload[column] === '' ? null : payload[column];
        }
    }

    data.shop_id = shopId;
    if (config.columns.includes('created_by') && !data.created_by) data.created_by = userId;
    if (config.columns.includes('received_by') && !data.received_by) data.received_by = userId;
    if (config.columns.includes('sold_by') && !data.sold_by) data.sold_by = userId;
    if (config.columns.includes('user_id') && !data.user_id) data.user_id = userId;

    if (!data.id) {
        throw new Error('Synced records must include a UUID id');
    }

    return data;
}

async function upsertRecord(table, config, data, shopId) {
    const [existing] = await pool.execute(
        `SELECT BIN_TO_UUID(id) AS id FROM ${table} WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?) LIMIT 1`,
        [data.id, shopId]
    );

    if (existing.length) {
        return updateRecord(table, config, data, data.id, shopId);
    }

    return insertRecord(table, config, data);
}

async function insertRecord(table, config, data) {
    const columns = config.columns.filter((column) => Object.prototype.hasOwnProperty.call(data, column));
    const placeholders = columns.map((column) => config.uuidColumns.includes(column) ? 'UUID_TO_BIN(?)' : '?');
    const params = columns.map((column) => data[column]);

    await pool.execute(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
        params
    );
}

async function updateRecord(table, config, data, id, shopId) {
    const columns = config.columns.filter((column) => (
        column !== 'id' &&
        Object.prototype.hasOwnProperty.call(data, column)
    ));

    if (!columns.length) return;

    const setClause = columns
        .map((column) => `${column} = ${config.uuidColumns.includes(column) ? 'UUID_TO_BIN(?)' : '?'}`)
        .join(', ');
    const params = columns.map((column) => data[column]);
    params.push(id, shopId);

    await pool.execute(
        `UPDATE ${table} SET ${setClause} WHERE id = UUID_TO_BIN(?) AND shop_id = UUID_TO_BIN(?)`,
        params
    );
}

module.exports = router;
