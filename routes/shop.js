const express = require('express');
const router = express.Router();
const shopSettingsController = require('../controllers/shopSettingsController');

// Mount all routes from controller
router.get('/', shopSettingsController);
router.post('/update', shopSettingsController);
router.post('/subscribe', shopSettingsController);
router.post('/cancel-subscription', shopSettingsController);
router.post('/update-status', shopSettingsController);
router.post('/backup', shopSettingsController);
router.get('/export-data', shopSettingsController);
router.get('/debug', shopSettingsController);

module.exports = router;