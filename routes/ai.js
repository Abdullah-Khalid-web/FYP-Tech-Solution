/**
 * AI Proxy Routes
 * Routes that the FRONTEND calls — backend proxies to the FastAPI AI module.
 * All routes require user authentication (session).
 */

const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');
const aiActionExecutor = require('../services/aiActionExecutor');
const { isAuthenticated } = require('../middleware/auth');

// All AI routes require authentication
router.use(isAuthenticated);

// =========================================================================
// Chat
// =========================================================================

/**
 * POST /api/ai/chat
 * Main AI chat endpoint — accepts natural language queries
 */
router.post('/chat', async (req, res) => {
  try {
    const { query, is_voice } = req.body;

    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const shopId = req.session.shopId;
    const userId = req.session.userId;
    const sessionId = req.sessionID;

    const result = await aiService.chat(query, shopId, userId, sessionId, is_voice || false);

    if (!result.success) {
      return res.status(502).json(result.data || { error: result.error });
    }

    // Check if the AI response includes an action to execute
    const aiResponse = result.data;

    // ── Sanitize the response field ──────────────────────────────────
    // Gemini sometimes returns a list of content-block objects instead
    // of a plain string.  Collapse it into readable text so the
    // frontend never sees "[object Object]".
    if (aiResponse.response && typeof aiResponse.response !== 'string') {
      if (Array.isArray(aiResponse.response)) {
        aiResponse.response = aiResponse.response
          .map(part => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object' && part.text) return part.text;
            if (part && typeof part === 'object' && part.content) return part.content;
            return '';
          })
          .filter(Boolean)
          .join(' ');
      } else {
        aiResponse.response = String(aiResponse.response);
      }
    }
    // ─────────────────────────────────────────────────────────────────

    if (aiResponse.data?.action && !aiResponse.requires_confirmation) {
      const actionResult = await aiActionExecutor.execute(
        aiResponse.data.action,
        aiResponse.data.params || {},
        { shopId, userId }
      );
      aiResponse.action_result = actionResult;
    }

    res.json(aiResponse);
  } catch (err) {
    console.error('[AI Route] Chat error:', err);
    res.status(500).json({ error: 'Failed to process AI chat' });
  }
});

// =========================================================================
// Voice Billing
// =========================================================================

/**
 * POST /api/ai/voice-billing
 * Process a voice billing command
 */
router.post('/voice-billing', async (req, res) => {
  try {
    const { audio_text, current_bill_id } = req.body;

    if (!audio_text) {
      return res.status(400).json({ error: 'Audio text is required' });
    }

    const shopId = req.session.shopId;
    const result = await aiService.voiceBilling(audio_text, shopId, current_bill_id);

    if (!result.success) {
      return res.status(502).json(result.data || { error: result.error });
    }

    res.json(result.data);
  } catch (err) {
    console.error('[AI Route] Voice billing error:', err);
    res.status(500).json({ error: 'Failed to process voice billing' });
  }
});

/**
 * POST /api/ai/billing-confirm
 * Confirm or cancel a pending billing action
 */
router.post('/billing-confirm', async (req, res) => {
  try {
    const { confirmed } = req.body;
    const result = await aiService.confirmBilling(confirmed !== false);

    if (!result.success) {
      return res.status(502).json(result.data || { error: result.error });
    }

    // If confirmed, execute the billing action
    if (confirmed !== false && result.data.status === 'success') {
      const shopId = req.session.shopId;
      const userId = req.session.userId;

      if (result.data.item_added) {
        await aiActionExecutor.execute('add_bill_item', result.data.item_added, { shopId, userId });
      }
    }

    res.json(result.data);
  } catch (err) {
    console.error('[AI Route] Billing confirm error:', err);
    res.status(500).json({ error: 'Failed to confirm billing' });
  }
});

// =========================================================================
// Stock Analysis
// =========================================================================

/**
 * POST /api/ai/stock-analyze
 * Analyze stock and get reorder recommendation
 */
router.post('/stock-analyze', async (req, res) => {
  try {
    const { product_name, product_id } = req.body;
    const shopId = req.session.shopId;

    const result = await aiService.analyzeStock(product_name, shopId, product_id);

    if (!result.success) {
      return res.status(502).json(result.data || { error: result.error });
    }

    res.json(result.data);
  } catch (err) {
    console.error('[AI Route] Stock analyze error:', err);
    res.status(500).json({ error: 'Failed to analyze stock' });
  }
});

/**
 * POST /api/ai/stock-approve
 * Approve or reject a reorder draft
 */
router.post('/stock-approve', async (req, res) => {
  try {
    const { draft_order_id, approved, modified_quantity } = req.body;

    const result = await aiService.approveReorder(draft_order_id, approved, modified_quantity);

    if (!result.success) {
      return res.status(502).json(result.data || { error: result.error });
    }

    res.json(result.data);
  } catch (err) {
    console.error('[AI Route] Stock approve error:', err);
    res.status(500).json({ error: 'Failed to approve reorder' });
  }
});

// =========================================================================
// Reports
// =========================================================================

/**
 * POST /api/ai/report-narrate
 * Generate a narrated report
 */
router.post('/report-narrate', async (req, res) => {
  try {
    const { report_type, start_date, end_date } = req.body;
    const shopId = req.session.shopId;

    const result = await aiService.narrateReport(report_type || 'daily', shopId, start_date, end_date);

    if (!result.success) {
      return res.status(502).json(result.data || { error: result.error });
    }

    res.json(result.data);
  } catch (err) {
    console.error('[AI Route] Report narrate error:', err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// =========================================================================
// Insights
// =========================================================================

/**
 * GET /api/ai/forecast
 */
router.get('/forecast', async (req, res) => {
  try {
    const result = await aiService.getForecast(req.query.product);

    if (!result.success) {
      return res.status(502).json(result.data || { error: result.error });
    }

    res.json(result.data);
  } catch (err) {
    console.error('[AI Route] Forecast error:', err);
    res.status(500).json({ error: 'Failed to get forecast' });
  }
});

/**
 * GET /api/ai/anomalies
 */
router.get('/anomalies', async (req, res) => {
  try {
    const result = await aiService.checkAnomalies(req.query.transaction_id);

    if (!result.success) {
      return res.status(502).json(result.data || { error: result.error });
    }

    res.json(result.data);
  } catch (err) {
    console.error('[AI Route] Anomalies error:', err);
    res.status(500).json({ error: 'Failed to check anomalies' });
  }
});

/**
 * GET /api/ai/staff-performance
 */
router.get('/staff-performance', async (req, res) => {
  try {
    const result = await aiService.getStaffPerformance(
      req.query.user_id,
      req.query.role,
      req.query.period
    );

    if (!result.success) {
      return res.status(502).json(result.data || { error: result.error });
    }

    res.json(result.data);
  } catch (err) {
    console.error('[AI Route] Staff performance error:', err);
    res.status(500).json({ error: 'Failed to get staff performance' });
  }
});

// =========================================================================
// Utility
// =========================================================================

/**
 * GET /api/ai/health
 * Check if AI module is running
 */
router.get('/health', async (req, res) => {
  const result = await aiService.healthCheck();
  res.json({
    ai_module: result.success ? 'connected' : 'disconnected',
    details: result.data || null,
  });
});

/**
 * POST /api/ai/reset
 * Reset AI conversation context
 */
router.post('/reset', async (req, res) => {
  const result = await aiService.resetContext();
  res.json(result.data || { status: 'reset' });
});

module.exports = router;
