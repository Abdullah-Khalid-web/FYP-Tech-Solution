const express = require('express');
const router = express.Router();
const rawController = require('../controllers/rawController');

// Apply all routes from the controller
router.use('/', rawController);

module.exports = router;