require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 3000;

function startServer() {
    const server = app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    return server;
}

// If not running in Electron, start server normally
if (!process.env.ELECTRON_START) {
    startServer();
}

module.exports = { startServer };
