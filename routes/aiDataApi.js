/**
 * AI Data API Routes
 * Data endpoints that the AI module calls BACK to the backend to fetch business data.
 * Protected by AI service key authentication.
 */

const express = require('express');
const router = express.Router();
const aiDataController = require('../controllers/aiDataController');
const { verifyAIServiceKey, aiRateLimit } = require('../middleware/aiAuth');

// All data API routes require AI service authentication
router.use(verifyAIServiceKey);
router.use(aiRateLimit);

// =========================================================================
// Sales
// =========================================================================
router.get('/sales/daily', aiDataController.getDailySales);
router.get('/sales/weekly', aiDataController.getWeeklySales);
router.get('/sales/monthly', aiDataController.getMonthlySales);
router.get('/sales/top-sellers', aiDataController.getTopSellers);
router.get('/sales/transactions', aiDataController.getTransactions);

// =========================================================================
// Products / Inventory
// =========================================================================
router.get('/products', aiDataController.getProducts);
router.get('/products/search', aiDataController.getProducts); // alias
router.get('/products/low-stock', aiDataController.getLowStock);
router.get('/products/:id/stock', aiDataController.getProductStock);

// =========================================================================
// Reports
// =========================================================================
router.get('/reports/daily', aiDataController.getDailyReport);
router.get('/reports/weekly', aiDataController.getWeeklyReport);
router.get('/reports/expenses', aiDataController.getExpenseReport);

// =========================================================================
// Analytics
// =========================================================================
router.get('/analytics/sales-trend', aiDataController.getSalesTrend);
router.get('/analytics/anomalies', aiDataController.getAnomalies);

// =========================================================================
// Staff
// =========================================================================
router.get('/users/performance', aiDataController.getStaffPerformance);

module.exports = router;
