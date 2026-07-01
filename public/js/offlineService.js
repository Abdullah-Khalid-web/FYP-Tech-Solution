// Public/js/offlineService.js

const OfflineService = {
    // ===== CHECK STATUS =====
    isOnline: () => navigator.onLine,

    // ===== SAVE WITH OFFLINE SUPPORT =====
    async saveRecord(table, data, action = 'create') {
        const id = data.id || generateUUID();
        data.id = id;
        data.sync_status = 'pending';

        if (this.isOnline()) {
            try {
                // Try online first
                const response = await fetch(`/api/sync/${table}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                
                if (response.ok) {
                    // Also save locally
                    await this.saveLocal(table, data);
                    return { success: true, id, online: true };
                }
            } catch (error) {
                console.log('Online save failed, falling back to offline');
            }
        }

        // Offline save
        await this.saveLocal(table, data);
        await this.addToSyncQueue(table, id, action, data);
        
        return { success: true, id, online: false, pending: true };
    },

    // ===== LOCAL DATABASE OPERATIONS =====
    saveLocal(table, data) {
        return new Promise((resolve, reject) => {
            const request = window.indexedDB.open('ManageHubDB', 1);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(table)) {
                    db.createObjectStore(table, { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => {
                const db = event.target.result;
                const transaction = db.transaction([table], 'readwrite');
                const store = transaction.objectStore(table);
                const request = store.put(data);
                
                request.onsuccess = () => resolve(data);
                request.onerror = () => reject(request.error);
            };

            request.onerror = () => reject(request.error);
        });
    },

    getLocal(table, id) {
        return new Promise((resolve, reject) => {
            const request = window.indexedDB.open('ManageHubDB', 1);
            
            request.onsuccess = (event) => {
                const db = event.target.result;
                const transaction = db.transaction([table], 'readonly');
                const store = transaction.objectStore(table);
                const request = store.get(id);
                
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            };
        });
    },

    getAllLocal(table) {
        return new Promise((resolve, reject) => {
            const request = window.indexedDB.open('ManageHubDB', 1);
            
            request.onsuccess = (event) => {
                const db = event.target.result;
                const transaction = db.transaction([table], 'readonly');
                const store = transaction.objectStore(table);
                const request = store.getAll();
                
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            };
        });
    },

    // ===== SYNC QUEUE =====
    addToSyncQueue(table, id, action, data) {
        return new Promise((resolve, reject) => {
            const request = window.indexedDB.open('ManageHubDB', 1);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('sync_queue')) {
                    const store = db.createObjectStore('sync_queue', { 
                        keyPath: 'id', 
                        autoIncrement: true 
                    });
                    store.createIndex('status', 'status');
                    store.createIndex('table', 'table_name');
                }
            };

            request.onsuccess = (event) => {
                const db = event.target.result;
                const transaction = db.transaction(['sync_queue'], 'readwrite');
                const store = transaction.objectStore('sync_queue');
                
                const syncItem = {
                    table_name: table,
                    record_id: id,
                    action: action,
                    payload: JSON.stringify(data),
                    status: 'pending',
                    created_at: new Date().toISOString()
                };
                
                const request = store.add(syncItem);
                request.onsuccess = () => resolve(syncItem);
                request.onerror = () => reject(request.error);
            };
        });
    },

    getPendingSync() {
        return new Promise((resolve, reject) => {
            const request = window.indexedDB.open('ManageHubDB', 1);
            
            request.onsuccess = (event) => {
                const db = event.target.result;
                const transaction = db.transaction(['sync_queue'], 'readonly');
                const store = transaction.objectStore('sync_queue');
                const index = store.index('status');
                const request = index.getAll('pending');
                
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            };
        });
    }
};

// ===== HELPER =====
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ===== INIT INDEXEDDB =====
function initOfflineDB() {
    return new Promise((resolve, reject) => {
        const request = window.indexedDB.open('ManageHubDB', 1);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // Create stores for each table
            const tables = ['products', 'expenses', 'suppliers', 'user_cash_submission', 'bills', 'users'];
            tables.forEach(table => {
                if (!db.objectStoreNames.contains(table)) {
                    db.createObjectStore(table, { keyPath: 'id' });
                }
            });

            // Sync queue store
            if (!db.objectStoreNames.contains('sync_queue')) {
                const store = db.createObjectStore('sync_queue', { 
                    keyPath: 'id', 
                    autoIncrement: true 
                });
                store.createIndex('status', 'status');
                store.createIndex('table', 'table_name');
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}