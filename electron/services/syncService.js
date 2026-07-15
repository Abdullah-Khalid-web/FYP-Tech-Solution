require('dotenv').config();
const axios = require('axios');
const dbService = require('./databaseService');

let electronSession = null;
try {
    electronSession = require('electron').session;
} catch (_) {
    electronSession = null;
}

const DEFAULT_API_URL = process.env.SYNC_API_URL || 'http://localhost:3000/api';

const SYNC_TABLES = [
    'shops',
    'roles',
    'users',
    'products',
    'inventory',
    'stock_in',
    'suppliers',
    'customers',
    'bills',
    'bill_items',
    'expenses',
    'user_cash_submission',
    'user_loan',
    'user_loan_ledger',
    'user_salary',
    'cash_register',
    'raw_materials',
    'raw_material_stock_movements',
    'ingredients',
    'supplier_transactions',
    'supplier_balance'
];

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
        upload: true,
        uuidColumns: ['id', 'shop_id', 'role_id'],
        columns: ['id', 'shop_id', 'role_id', 'name', 'email', 'password', 'phone', 'salary', 'loan', 'cnic', 'status', 'created_at', 'updated_at', 'notes', 'profile_picture']
    },
    products: {
        upload: true,
        uuidColumns: ['id', 'shop_id'],
        columns: ['id', 'shop_id', 'name', 'brand', 'category', 'size', 'sku', 'barcode', 'active', 'created_at', 'updated_at']
    },
    inventory: {
        upload: true,
        uuidColumns: ['id', 'shop_id', 'product_id'],
        columns: ['id', 'shop_id', 'product_id', 'current_quantity', 'avg_cost', 'selling_price', 'last_buying_price', 'min_stock_level', 'updated_at']
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
        uuidColumns: ['id', 'shop_id', 'user_id', 'verified_by'],
        columns: ['id', 'shop_id', 'user_id', 'submission_date', 'total_collected', 'submitted_amount', 'notes', 'created_at', 'status', 'verified_by', 'verified_at', 'rejection_reason', 'shift', 'payment_method', 'reference_number']
    },
    user_loan: {
        upload: true,
        uuidColumns: ['id', 'shop_id', 'user_id', 'created_by'],
        columns: ['id', 'shop_id', 'user_id', 'loan_number', 'loan_type', 'total_amount', 'total_paid', 'installments', 'installment_amount', 'description', 'loan_date', 'status', 'created_by', 'created_at', 'updated_at']
    },
    user_loan_ledger: {
        upload: true,
        uuidColumns: ['id', 'loan_id', 'shop_id', 'user_id', 'reference_id', 'created_by'],
        columns: ['id', 'loan_id', 'shop_id', 'user_id', 'transaction_type', 'amount', 'description', 'payment_method', 'reference_id', 'reference_type', 'created_by', 'created_at']
    },
    user_salary: {
        upload: true,
        uuidColumns: ['id', 'shop_id', 'user_id'],
        columns: ['id', 'shop_id', 'user_id', 'amount', 'bonus', 'fine', 'month', 'paid_on', 'status', 'notes', 'created_at', 'updated_at']
    },
    cash_register: {
        upload: true,
        uuidColumns: ['id', 'shop_id', 'user_id'],
        columns: ['id', 'shop_id', 'user_id', 'shift_start', 'shift_end', 'opening_balance', 'closing_balance', 'expected_balance', 'difference', 'status', 'notes', 'created_at']
    },
    raw_materials: {
        upload: true,
        uuidColumns: ['id', 'shop_id', 'supplier_id', 'created_by'],
        columns: ['id', 'shop_id', 'name', 'sku', 'barcode', 'category', 'description', 'unit_of_measure', 'current_stock', 'min_stock_level', 'max_stock_level', 'cost_price', 'supplier_id', 'batch_tracking', 'expiry_tracking', 'is_active', 'created_by', 'created_at', 'updated_at']
    },
    raw_material_stock_movements: {
        upload: true,
        uuidColumns: ['id', 'shop_id', 'raw_material_id', 'reference_id', 'supplier_id', 'created_by'],
        columns: ['id', 'shop_id', 'raw_material_id', 'batch_number', 'movement_type', 'quantity', 'unit_cost', 'total_cost', 'reference_type', 'reference_id', 'supplier_id', 'notes', 'movement_date', 'expiry_date', 'created_by', 'created_at']
    },
    ingredients: {
        upload: true,
        uuidColumns: ['id', 'shop_id', 'main_product_id', 'raw_material_id'],
        columns: ['id', 'shop_id', 'main_product_id', 'raw_material_id', 'quantity_required', 'unit', 'created_at']
    },
    supplier_transactions: {
        upload: true,
        uuidColumns: ['id', 'shop_id', 'supplier_id', 'reference_id', 'created_by'],
        columns: ['id', 'shop_id', 'supplier_id', 'type', 'amount', 'description', 'reference_type', 'reference_id', 'created_by', 'created_at']
    },
    supplier_balance: {
        upload: true,
        uuidColumns: ['id', 'shop_id', 'supplier_id'],
        columns: ['id', 'shop_id', 'supplier_id', 'total_debit', 'total_credit']
    }
};

class SyncService {
    constructor() {
        this.isSyncing = false;
        this.syncInterval = null;
        this.apiUrl = DEFAULT_API_URL;
        this.statusListeners = new Set();
        this.lastStatus = {
            state: 'idle',
            pending: 0,
            lastSyncedAt: null,
            error: null,
            mysqlConnected: false
        };
    }

    isElectronMode() {
        return process.env.ELECTRON_START === '1' || process.env.DB_MODE === 'sqlite';
    }

    getMysqlConfig() {
        return {
            host: process.env.DB_HOST || 'localhost',
            port: Number(process.env.DB_PORT || 3306),
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'manage_hub1',
            connectTimeout: 4000
        };
    }

    async testMysqlConnection() {
        const mysql = require('mysql2/promise');
        let conn;
        try {
            conn = await mysql.createConnection(this.getMysqlConfig());
            await conn.query('SELECT 1');
            return true;
        } catch (_) {
            return false;
        } finally {
            if (conn) {
                await conn.end().catch(() => {});
            }
        }
    }

    onStatusChange(listener) {
        this.statusListeners.add(listener);
        return () => this.statusListeners.delete(listener);
    }

    notifyStatusChange() {
        const status = this.getStatus();
        for (const listener of this.statusListeners) {
            try {
                listener(status);
            } catch (error) {
                console.error('Sync status listener error:', error);
            }
        }
    }

    setApiUrl(url) {
        this.apiUrl = url.replace(/\/$/, '');
    }

    getStatus() {
        return { ...this.lastStatus, isSyncing: this.isSyncing };
    }

    startAutoSync(intervalMs = 60000) {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }

        this.syncInterval = setInterval(() => {
            this.syncAll().catch((error) => {
                console.error('Auto-sync failed:', error);
            });
        }, intervalMs);

        this.syncAll().catch((error) => {
            console.error('Initial sync failed:', error);
        });
    }

    stopAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    async syncAll() {
        if (this.isSyncing) {
            return this.getStatus();
        }

        this.isSyncing = true;
        this.setStatus({ state: 'syncing', error: null });

        try {
            const pendingBefore = await dbService.getPendingSyncCount();

            if (this.isElectronMode()) {
                const mysqlConnected = await this.testMysqlConnection();
                this.setStatus({ mysqlConnected });

                if (!mysqlConnected) {
                    this.setStatus({
                        state: 'offline',
                        pending: pendingBefore,
                        error: null
                    });
                    return this.getStatus();
                }

                const success = await this.syncDirectlyWithMysql();
                const pendingAfter = await dbService.getPendingSyncCount();

                this.setStatus({
                    state: success && pendingAfter === 0 ? 'synced' : (pendingAfter > 0 ? 'pending' : 'synced'),
                    pending: pendingAfter,
                    lastSyncedAt: success ? new Date().toISOString() : this.lastStatus.lastSyncedAt,
                    mysqlConnected: true,
                    error: success ? null : 'Some records failed to sync'
                });
                return this.getStatus();
            }

            const manifest = await this.getManifest();
            if (!manifest.subscription?.offline_allowed) {
                this.setStatus({
                    state: 'disabled',
                    pending: await dbService.getPendingSyncCount(),
                    error: null
                });
                return this.getStatus();
            }

            await this.uploadPendingChanges();
            await this.downloadRemoteChanges(manifest.tables || SYNC_TABLES);

            this.setStatus({
                state: 'synced',
                pending: await dbService.getPendingSyncCount(),
                lastSyncedAt: new Date().toISOString(),
                mysqlConnected: true,
                error: null
            });
        } catch (error) {
            if (error.response?.status === 402) {
                this.setStatus({
                    state: 'disabled',
                    pending: await dbService.getPendingSyncCount(),
                    error: null
                });
                return this.getStatus();
            }

            const pending = await dbService.getPendingSyncCount();
            this.setStatus({
                state: 'offline',
                pending,
                mysqlConnected: false,
                error: error.response?.data?.error || error.message
            });
            console.warn('Sync unavailable, continuing in offline mode:', error.response?.data || error.message);
        } finally {
            this.isSyncing = false;
            this.notifyStatusChange();
        }

        return this.getStatus();
    }

    async syncDirectlyWithMysql() {
        const mysql = require('mysql2/promise');
        const { disableSyncTriggers, enableSyncTriggers, persistDatabase } = require('../database/init');
        const conn = await mysql.createConnection(this.getMysqlConfig());
        let uploadFailures = 0;

        try {
            const db = await dbService.getDb();
            const shopRows = await dbService.runSelect(db, 'SELECT DISTINCT shop_id FROM users WHERE shop_id IS NOT NULL');
            const shopIds = shopRows.map(r => r.shop_id);
            if (!shopIds.length) {
                console.log('[SyncService] No active shops found in local users table; pending changes will still be uploaded, but downloading remote data is skipped.');
            }

            const bufferToUuid = (buf) => {
                if (!buf) return null;
                if (typeof buf === 'string') return buf;
                if (buf instanceof Uint8Array || Buffer.isBuffer(buf)) {
                    if (buf.length === 16) {
                        const hex = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
                        return [
                            hex.substring(0, 8),
                            hex.substring(8, 12),
                            hex.substring(12, 16),
                            hex.substring(16, 20),
                            hex.substring(20, 32)
                        ].join('-');
                    }
                }
                return buf;
            };

            const uuidToBin = (uuid) => {
                if (!uuid) return null;
                const hex = String(uuid).replace(/-/g, '');
                return Buffer.from(hex, 'hex');
            };

            // 1. Upload pending changes from SQLite sync_queue to MySQL.
            // Drain the whole backlog (not just one 100-row batch) so a large queue
            // doesn't take multiple 30s ticks — or get starved by newer items — to clear.
            let uploadedThisRun = 0;
            let batch;
            do {
                batch = await dbService.getPendingSyncItems(200);
                if (!batch.length) break;
                console.log(`[SyncService] Uploading ${batch.length} pending change(s) to MySQL...`);

                for (const item of batch) {
                try {
                    const payload = JSON.parse(item.payload || '{}');
                    payload.id = item.record_id;
                    const tableName = item.table_name;
                    const config = TABLES[tableName];
                    if (!config) {
                        await dbService.markSyncCompleted(item.id);
                        continue;
                    }

                    if (item.action === 'delete') {
                        await conn.query(
                            `DELETE FROM ${tableName} WHERE id = ?`,
                            [uuidToBin(item.record_id)]
                        );
                    } else {
                        const mysqlCols = config.columns.filter(col => Object.prototype.hasOwnProperty.call(payload, col));
                        if (!mysqlCols.length) {
                            await dbService.markSyncCompleted(item.id);
                            continue;
                        }

                        const params = mysqlCols.map(col => {
                            let val = payload[col];
                            if (config.uuidColumns.includes(col) && val) {
                                return uuidToBin(val);
                            }
                            return val;
                        });

                        if (item.action === 'update') {
                            const setClause = mysqlCols.filter(col => col !== 'id').map(col => `${col} = ?`).join(', ');
                            const updateParams = mysqlCols
                                .filter(col => col !== 'id')
                                .map(col => {
                                    let val = payload[col];
                                    if (config.uuidColumns.includes(col) && val) {
                                        return uuidToBin(val);
                                    }
                                    return val;
                                });
                            updateParams.push(uuidToBin(item.record_id));
                            await conn.query(
                                `UPDATE ${tableName} SET ${setClause} WHERE id = ?`,
                                updateParams
                            );
                        } else {
                            const placeholders = mysqlCols.map(() => '?').join(', ');
                            const updateClause = mysqlCols
                                .filter(col => col !== 'id')
                                .map(col => `${col} = VALUES(${col})`)
                                .join(', ');
                            await conn.query(
                                `INSERT INTO ${tableName} (${mysqlCols.join(', ')}) VALUES (${placeholders})
                                 ON DUPLICATE KEY UPDATE ${updateClause}`,
                                params
                            );
                        }
                    }

                    await dbService.markSyncCompleted(item.id);
                    console.log(`[SyncService] Synced ${item.action} on ${tableName}:${item.record_id}`);
                } catch (err) {
                    uploadFailures += 1;
                    console.error(`[SyncService] Direct upload failed for queue item ${item.id}:`, err.message);
                    await dbService.markSyncFailed(item.id, err.message);
                }
                }

                uploadedThisRun += batch.length;
                // Safety cap: never loop forever within a single sync tick even if
                // something keeps re-queueing items faster than we can drain them.
            } while (batch.length > 0 && uploadedThisRun < 5000);

            // 2. Download remote changes from MySQL to SQLite (disable triggers to avoid re-queueing).
            // Skipped entirely when we have no local shop scope to filter by.
            if (!shopIds.length) {
                return uploadFailures === 0;
            }

            disableSyncTriggers(db);

            try {
                for (const table of SYNC_TABLES) {
                    try {
                        const config = TABLES[table];
                        if (!config) continue;

                        const lastSync = await dbService.getLastSyncTime(table);
                        let query = `SELECT * FROM ${table}`;
                        const params = [];
                        const where = [];

                        if (table === 'shops') {
                            where.push(`id IN (${shopIds.map(() => '?').join(', ')})`);
                            params.push(...shopIds.map(id => uuidToBin(id)));
                        } else if (config.shopScoped !== false && config.columns.includes('shop_id')) {
                            where.push(`shop_id IN (${shopIds.map(() => '?').join(', ')})`);
                            params.push(...shopIds.map(id => uuidToBin(id)));
                        }

                        if (lastSync && config.columns.includes('updated_at')) {
                            where.push('updated_at > ?');
                            params.push(lastSync);
                        } else if (lastSync && config.columns.includes('created_at')) {
                            where.push('created_at > ?');
                            params.push(lastSync);
                        }

                        if (where.length) {
                            query += ` WHERE ${where.join(' AND ')}`;
                        }

                        const [rows] = await conn.query(query, params);

                        const sqliteColumns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
                        const sqliteColumnsSet = new Set(sqliteColumns);

                        db.exec('PRAGMA foreign_keys = OFF');
                        for (const row of rows) {
                            const columnsToInsert = Object.keys(row).filter(col => sqliteColumnsSet.has(col));
                            if (columnsToInsert.length === 0) continue;

                            const placeholders = columnsToInsert.map(() => '?').join(', ');
                            const insertSql = `INSERT OR REPLACE INTO ${table} (${columnsToInsert.join(', ')}) VALUES (${placeholders})`;

                            const stmt = db.prepare(insertSql);
                            const insertParams = columnsToInsert.map(col => {
                                let val = row[col];
                                val = bufferToUuid(val);
                                if (val instanceof Date && !isNaN(val.valueOf())) {
                                    val = val.toISOString();
                                }
                                return val;
                            });
                            stmt.run(insertParams);
                            stmt.free();
                        }
                        db.exec('PRAGMA foreign_keys = ON');

                        await dbService.updateLastSyncTime(table, 'success', rows.length);
                    } catch (tableErr) {
                        console.error(`[SyncService] Direct download failed for table ${table}:`, tableErr.message);
                    }
                }
            } finally {
                enableSyncTriggers(db);
                await persistDatabase();
            }

            return uploadFailures === 0;
        } finally {
            await conn.end();
        }
    }

    async getManifest() {
        const response = await this.request({
            method: 'GET',
            url: '/sync/manifest'
        });
        return response.data;
    }

    async uploadPendingChanges() {
        const pendingItems = await dbService.getPendingSyncItems();
        if (!pendingItems.length) return;

        for (const item of pendingItems) {
            try {
                await this.uploadItem(item);
                await dbService.markSyncCompleted(item.id);
            } catch (error) {
                await dbService.markSyncFailed(item.id, error.response?.data?.error || error.message);
            }
        }
    }

    async uploadItem(item) {
        const payload = JSON.parse(item.payload || '{}');
        payload.id = item.record_id;

        if (item.action === 'delete') {
            return this.request({
                method: 'DELETE',
                url: `/sync/${item.table_name}/${item.record_id}`
            });
        }

        return this.request({
            method: item.action === 'update' ? 'PUT' : 'POST',
            url: item.action === 'update'
                ? `/sync/${item.table_name}/${item.record_id}`
                : `/sync/${item.table_name}`,
            data: payload
        });
    }

    async downloadRemoteChanges(tables) {
        for (const table of tables.filter((name) => SYNC_TABLES.includes(name))) {
            await this.downloadTableChanges(table);
        }
    }

    async downloadTableChanges(table) {
        const lastSync = await dbService.getLastSyncTime(table);
        const response = await this.request({
            method: 'GET',
            url: `/sync/${table}/changes`,
            params: lastSync ? { since: lastSync } : undefined
        });

        const changes = Array.isArray(response.data) ? response.data : [];
        await this.processTableChanges(table, changes);
        await dbService.updateLastSyncTime(table, 'success', changes.length);
    }

    async processTableChanges(table, changes) {
        for (const record of changes) {
            try {
                if (table === 'users' && !record.password) {
                    record.password = 'default123';
                }
                const existing = await dbService.find(table, record.id);
                if (existing) {
                    await dbService.update(table, record.id, record);
                } else {
                    await dbService.insert(table, record);
                }
                await dbService.removePendingForRecord(table, record.id);
            } catch (error) {
                console.error(`Failed to process ${table} record ${record.id}:`, error);
            }
        }
    }

    async forceSync() {
        return this.syncAll();
    }

    async request(config) {
        const cookie = await this.getCookieHeader();
        return axios({
            baseURL: this.apiUrl,
            timeout: 20000,
            validateStatus: (status) => status >= 200 && status < 300,
            headers: {
                'Content-Type': 'application/json',
                ...(cookie ? { Cookie: cookie } : {})
            },
            ...config
        });
    }

    async getCookieHeader() {
        if (!electronSession) {
            return '';
        }

        const appUrl = this.apiUrl.replace(/\/api$/, '');
        const cookies = await electronSession.defaultSession.cookies.get({ url: appUrl });
        return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    }

    setStatus(nextStatus) {
        this.lastStatus = { ...this.lastStatus, ...nextStatus };
    }
}

module.exports = new SyncService();
