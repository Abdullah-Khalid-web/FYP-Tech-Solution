require('dotenv').config();
const app = require('./app');
const net = require('net');

const PREFERRED_PORT = parseInt(process.env.PORT || '3000', 10);
// Electron defaults to a different port than the plain web server (3000) so the
// two don't race for the same port when both are run side by side during dev —
// previously they'd both try 3000, and whichever lost the race got silently
// served by the other (e.g. Electron talking to the online MySQL dev server).
const ELECTRON_PREFERRED_PORT = parseInt(process.env.ELECTRON_PORT_BASE || '3500', 10);

// Check if a port is free
function isPortFree(port) {
    return new Promise((resolve) => {
        const tester = net.createServer()
            .once('error', () => resolve(false))
            .once('listening', () => tester.close(() => resolve(true)))
            .listen(port, '0.0.0.0');
    });
}

// Find a free port starting from preferred
async function findFreePort(preferred) {
    for (let port = preferred; port < preferred + 20; port++) {
        if (await isPortFree(port)) return port;
    }
    return preferred; // fallback, will error at listen
}

function startServer() {
    return new Promise(async (resolve, reject) => {
        const isElectron = !!process.env.ELECTRON_START;
        let port = PREFERRED_PORT;

        if (isElectron) {
            // In Electron mode, find a free port so we don't clash with any running web server
            port = await findFreePort(ELECTRON_PREFERRED_PORT);
            if (port !== ELECTRON_PREFERRED_PORT) {
                console.log(`⚠️  Port ${ELECTRON_PREFERRED_PORT} in use. Electron using port ${port} instead.`);
            }
            // Store it so the Electron window can load the right URL
            process.env.ELECTRON_PORT = String(port);
        }

        const server = app.listen(port, () => {
            console.log(`🚀 Server running on http://localhost:${port}`);
            console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
            resolve(server);
        });

        server.on('error', (err) => {
            console.error('Server startup error:', err);
            reject(err);
        });
    });
}

// If not running in Electron, start server normally
if (!process.env.ELECTRON_START) {
    startServer().catch((err) => {
        console.error('Failed to start server:', err);
    });
}

module.exports = { startServer };
