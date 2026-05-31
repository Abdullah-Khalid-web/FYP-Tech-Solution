const express = require('express');
const router = express.Router();
const shopSettingsController = require('../controllers/shopSettingsController');

router.use('/', shopSettingsController);

module.exports = router;
