const axios = require('axios');
const { session } = require('electron');
const dbService = require('./databaseService');

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
    'user_cash_submission'
];

class SyncService {
    constructor() {
        this.isSyncing = false;
        this.syncInterval = null;
        this.apiUrl = DEFAULT_API_URL;
        this.lastStatus = {
            state: 'idle',
            pending: 0,
            lastSyncedAt: null,
            error: null
        };
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
            const manifest = await this.getManifest();
            if (!manifest.subscription?.offline_allowed) {
                throw new Error('Current subscription does not include offline sync');
            }

            await this.uploadPendingChanges();
            await this.downloadRemoteChanges(manifest.tables || SYNC_TABLES);

            this.setStatus({
                state: 'synced',
                pending: dbService.getPendingSyncItems().length,
                lastSyncedAt: new Date().toISOString(),
                error: null
            });
        } catch (error) {
            this.setStatus({
                state: 'error',
                pending: dbService.getPendingSyncItems().length,
                error: error.response?.data?.error || error.message
            });
            console.error('Sync error:', error.response?.data || error.message);
        } finally {
            this.isSyncing = false;
        }

        return this.getStatus();
    }

    async getManifest() {
        const response = await this.request({
            method: 'GET',
            url: '/sync/manifest'
        });
        return response.data;
    }

    async uploadPendingChanges() {
        const pendingItems = dbService.getPendingSyncItems();
        if (!pendingItems.length) return;

        for (const item of pendingItems) {
            try {
                await this.uploadItem(item);
                dbService.markSyncCompleted(item.id);
            } catch (error) {
                dbService.markSyncFailed(item.id, error.response?.data?.error || error.message);
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
        const lastSync = dbService.getLastSyncTime(table);
        const response = await this.request({
            method: 'GET',
            url: `/sync/${table}/changes`,
            params: lastSync ? { since: lastSync } : undefined
        });

        const changes = Array.isArray(response.data) ? response.data : [];
        await this.processTableChanges(table, changes);
        dbService.updateLastSyncTime(table, 'success', changes.length);
    }

    async processTableChanges(table, changes) {
        for (const record of changes) {
            try {
                const existing = dbService.find(table, record.id);
                if (existing) {
                    dbService.update(table, record.id, record);
                } else {
                    dbService.insert(table, record);
                }
                dbService.removePendingForRecord(table, record.id);
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
        const appUrl = this.apiUrl.replace(/\/api$/, '');
        const cookies = await session.defaultSession.cookies.get({ url: appUrl });
        return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    }

    setStatus(nextStatus) {
        this.lastStatus = { ...this.lastStatus, ...nextStatus };
    }
}

module.exports = new SyncService();
