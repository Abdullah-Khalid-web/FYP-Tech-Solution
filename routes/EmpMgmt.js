// EmpMgmt.js
const express = require('express');
const router = express.Router();
const empmgmtController = require('../controllers/empmgmtController');

// Apply all routes from the controller
router.use('/', empmgmtController);

module.exports = router;