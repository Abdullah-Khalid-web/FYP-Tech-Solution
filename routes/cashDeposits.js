const express = require('express');
const router = express.Router();
const cashDepositController = require('../controllers/cashDepositController');
const { isAuthenticated, hasPermission } = require('../middleware/auth');

// All routes require authentication
router.use(isAuthenticated);

// Main routes
router.get('/', cashDepositController.getCashDeposits);
router.post('/', hasPermission('cash.submit'), cashDepositController.createCashDeposit);
router.get('/register', cashDepositController.getCashRegister);
router.post('/register/open', cashDepositController.openCashRegister);
router.post('/register/close', cashDepositController.closeCashRegister);
router.put('/:id/verify', hasPermission('cash.verify'), cashDepositController.verifyCashDeposit);
router.delete('/:id', hasPermission('cash.delete'), cashDepositController.deleteCashDeposit);
router.get('/reports', hasPermission('cash.reports'), cashDepositController.getCashReports);
router.get('/summary', cashDepositController.getCashSummary);
router.get('/export', hasPermission('cash.reports'), cashDepositController.exportCashDeposits);

module.exports = router;