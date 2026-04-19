const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// Apply all routes from the controller
router.use('/', userController);

module.exports = router;