const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        send: (channel, data) => {
            // Whitelist channels
            let validChannels = [
                'sync:force', 
                'sync:status',
                'app:get-version',
                'app:get-path'
            ];
            if (validChannels.includes(channel)) {
                ipcRenderer.send(channel, data);
            }
        },
        invoke: (channel, data) => {
            let validChannels = [
                'sync:force', 
                'sync:status',
                'app:get-version',
                'app:get-path'
            ];
            if (validChannels.includes(channel)) {
                return ipcRenderer.invoke(channel, data);
            }
        },
        on: (channel, func) => {
            let validChannels = ['sync:status-changed'];
            if (validChannels.includes(channel)) {
                // Deliberately strip event as it includes `sender`
                ipcRenderer.on(channel, (event, ...args) => func(...args));
            }
        }
    },
    // Expose app information
    app: {
        getVersion: () => ipcRenderer.invoke('app:get-version'),
        getPath: (name) => ipcRenderer.invoke('app:get-path', name)
    },
    sync: {
        force: () => ipcRenderer.invoke('sync:force'),
        status: () => ipcRenderer.invoke('sync:status')
    }
});

console.log('Preload script loaded');
