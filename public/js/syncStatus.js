// public/js/syncStatus.js
// Shows accurate SQLite ↔ MySQL sync status in the Electron desktop app.

(function () {
    'use strict';

    let lastState = null;
    let checkInterval = null;
    let bannerEl = null;
    let bannerTimeout = null;
    let isElectron = !!(window.syncService || window.electron?.sync);

    function showToastBanner(message, type) {
        if (bannerEl) {
            bannerEl.remove();
            bannerEl = null;
        }
        if (bannerTimeout) clearTimeout(bannerTimeout);

        bannerEl = document.createElement('div');
        bannerEl.id = 'syncToastBanner';
        bannerEl.style.cssText = `
            position: fixed;
            top: 75px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 9999;
            padding: 12px 24px;
            border-radius: 12px;
            font-size: 0.9rem;
            font-weight: 600;
            box-shadow: 0 8px 30px rgba(0,0,0,0.18);
            display: flex;
            align-items: center;
            gap: 10px;
            animation: slideDown 0.4s ease;
            backdrop-filter: blur(12px);
            ${type === 'online'
                ? 'background:#dcfce7;color:#166534;border:1.5px solid #86efac;'
                : type === 'syncing'
                    ? 'background:#dbeafe;color:#1e40af;border:1.5px solid #93c5fd;'
                    : type === 'pending'
                        ? 'background:#fef3c7;color:#92400e;border:1.5px solid #fcd34d;'
                        : 'background:#fee2e2;color:#991b1b;border:1.5px solid #fca5a5;'
            }
        `;

        if (!document.getElementById('syncBannerStyle')) {
            const style = document.createElement('style');
            style.id = 'syncBannerStyle';
            style.textContent = `
                @keyframes slideDown {
                    from { opacity:0; top:60px; }
                    to   { opacity:1; top:75px; }
                }
                @keyframes slideUp {
                    from { opacity:1; top:75px; }
                    to   { opacity:0; top:60px; }
                }
            `;
            document.head.appendChild(style);
        }

        bannerEl.innerHTML = message;
        document.body.appendChild(bannerEl);

        bannerTimeout = setTimeout(() => {
            if (bannerEl) {
                bannerEl.style.animation = 'slideUp 0.3s ease forwards';
                setTimeout(() => { if (bannerEl) { bannerEl.remove(); bannerEl = null; } }, 300);
            }
        }, 4000);
    }

    async function fetchSyncHealth() {
        try {
            const res = await fetch('/api/sync-health', {
                method: 'GET',
                cache: 'no-store',
                signal: AbortSignal.timeout(5000)
            });
            if (!res.ok) {
                return { mysqlConnected: false, pendingCount: 0, state: 'offline' };
            }
            return await res.json();
        } catch (_) {
            return { mysqlConnected: false, pendingCount: 0, state: 'offline' };
        }
    }

    async function triggerSync() {
        try {
            if (window.syncService?.forceSync) {
                await window.syncService.forceSync();
                return;
            }
            await fetch('/api/sync-now', { method: 'POST', cache: 'no-store' });
        } catch (_) { /* silent */ }
    }

    function resolveUiState(data) {
        if (data.state) {
            if (data.state === 'synced') return 'online';
            if (data.state === 'syncing' || data.state === 'pending') return 'syncing';
            if (data.state === 'disabled') return 'disabled';
            return 'offline';
        }

        if (!data.mysqlConnected) return 'offline';
        if (data.pendingCount > 0) return 'syncing';
        return 'online';
    }

    function renderPill(pill, uiState, pendingCount) {
        if (uiState === 'online') {
            pill.className = 'sync-status online';
            pill.innerHTML = '🟢 Live & Synced';
            pill.title = 'All local changes are saved to MySQL';
        } else if (uiState === 'syncing') {
            pill.className = 'sync-status syncing';
            pill.innerHTML = `🔄 Syncing (${pendingCount || 0} pending)`;
            pill.title = 'Uploading offline changes to MySQL…';
        } else if (uiState === 'disabled') {
            pill.className = 'sync-status disabled';
            pill.innerHTML = '🔒 Sync disabled';
            pill.title = 'Your plan does not include offline sync';
        } else {
            pill.className = 'sync-status offline';
            pill.innerHTML = '📴 Offline — working locally';
            pill.title = 'MySQL server not reachable. Changes will sync when you go online.';
        }
    }

    async function updateStatus() {
        const pill = document.getElementById('syncStatus');
        if (!pill) return;

        const data = await fetchSyncHealth();
        const uiState = resolveUiState(data);
        const pendingCount = data.pendingCount || 0;

        if (uiState !== lastState) {
            if (uiState === 'online' && lastState !== null && lastState !== 'online') {
                showToastBanner('✅ Connected to MySQL — your store is now synced', 'online');
            } else if (uiState === 'syncing' && lastState !== 'syncing') {
                showToastBanner(`🔄 Syncing <strong>${pendingCount}</strong> offline change(s) to MySQL…`, 'syncing');
                triggerSync();
            } else if (uiState === 'offline' && lastState !== null && lastState !== 'offline') {
                showToastBanner('📴 Offline — changes are saved locally and will sync when MySQL is available', 'offline');
            }
            lastState = uiState;
        }

        renderPill(pill, uiState, pendingCount);

        if (isElectron && uiState === 'syncing' && pendingCount > 0) {
            triggerSync();
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        updateStatus();
        checkInterval = setInterval(updateStatus, 10000);

        window.addEventListener('online', () => {
            lastState = null;
            updateStatus();
            triggerSync();
        });

        window.addEventListener('offline', () => {
            lastState = null;
            updateStatus();
        });

        if (window.electron?.ipcRenderer?.on) {
            window.electron.ipcRenderer.on('sync:status-changed', () => {
                updateStatus();
            });
        }
    });
})();
