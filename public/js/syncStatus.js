// Public/js/syncStatus.js

class SyncStatusUI {
    constructor() {
        this.container = document.getElementById('syncStatus');
        this.checkInterval = null;
    }

    init() {
        this.updateStatus();
        this.checkInterval = setInterval(() => this.updateStatus(), 30000);
        
        // Listen for online/offline events
        window.addEventListener('online', () => this.updateStatus());
        window.addEventListener('offline', () => this.updateStatus());
    }

    async updateStatus() {
        if (!this.container) return;

        const isOnline = navigator.onLine;
        const pending = await OfflineService.getPendingSync();

        if (isOnline && pending.length === 0) {
            this.container.innerHTML = '🟢 All synced';
            this.container.className = 'sync-status online';
        } else if (isOnline && pending.length > 0) {
            this.container.innerHTML = `🔄 Syncing... (${pending.length} pending)`;
            this.container.className = 'sync-status syncing';
            
            // Trigger sync if online
            if (window.syncService) {
                await window.syncService.syncAll();
            }
        } else {
            this.container.innerHTML = `📴 Offline (${pending.length} pending)`;
            this.container.className = 'sync-status offline';
        }
    }

    destroy() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
    }
}