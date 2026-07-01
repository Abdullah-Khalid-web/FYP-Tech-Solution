process.env.ELECTRON_START = '1';

const { app, BrowserWindow, ipcMain, Menu, Tray, shell } = require('electron');
const path = require('path');
const { initDatabase } = require('./database/init');
const syncService = require('./services/syncService');

let mainWindow;
let tray = null;
let expressServer = null;

// Enable live reload in development
if (process.env.NODE_ENV === 'development') {
    require('electron-reload')(__dirname, {
        electron: path.join(__dirname, '..', 'node_modules', '.bin', 'electron'),
        hardResetMethod: 'exit'
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 768,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            devTools: process.env.NODE_ENV === 'development'
        },
        icon: path.join(__dirname, '../public/images/icon.ico'),
        show: false,
        frame: true,
        titleBarStyle: 'default'
    });

    // Load the Express app
    const url = process.env.NODE_ENV === 'development' 
        ? 'http://localhost:3000' 
        : 'http://localhost:3000';
    
    mainWindow.loadURL(url);

    // Show when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        if (process.env.NODE_ENV === 'development') {
            mainWindow.webContents.openDevTools();
        }
    });

    // Handle external links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.webContents.on('new-window', (event, url) => {
        event.preventDefault();
        shell.openExternal(url);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Create application menu
    createMenu();
}

function createMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Window',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => createWindow()
                },
                { type: 'separator' },
                {
                    label: 'Exit',
                    accelerator: 'CmdOrCtrl+Q',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Documentation',
                    click: () => shell.openExternal('https://github.com/your-repo/managehub')
                },
                { type: 'separator' },
                {
                    label: 'About ManageHub',
                    click: () => {
                        // Show about dialog
                        app.showAboutPanel();
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// App lifecycle
app.whenReady().then(async () => {
    try {
        // Initialize SQLite database
        await initDatabase();
        console.log('✅ SQLite database initialized');

        // Start Express server
        const { startServer } = require('../server');
        expressServer = startServer();
        console.log('✅ Express server started on port 3000');

        syncService.startAutoSync();

        // Create main window
        createWindow();
        console.log('✅ Electron window created');
    } catch (error) {
        console.error('❌ Startup error:', error);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (expressServer) {
            expressServer.close();
        }
        syncService.stopAutoSync();
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// IPC handlers
ipcMain.handle('app:get-version', () => {
    return app.getVersion();
});

ipcMain.handle('app:get-path', (event, name) => {
    return app.getPath(name);
});

ipcMain.handle('sync:force', async () => {
    return syncService.forceSync();
});

ipcMain.handle('sync:status', () => {
    return syncService.getStatus();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});
