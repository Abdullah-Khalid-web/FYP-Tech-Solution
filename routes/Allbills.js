const express = require('express');
const router = express.Router();
const allbillsController = require('../controllers/allbillsController');

// Apply all routes from the controller
router.use('/', allbillsController);

module.exports = router;