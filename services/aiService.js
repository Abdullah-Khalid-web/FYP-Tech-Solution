/**
 * AI Service Client
 * Handles all HTTP communication from Node.js backend → FastAPI AI module.
 * 
 * Features:
 * - Retry logic with exponential backoff
 * - Circuit breaker (fail-fast when AI is down)
 * - Request timeout
 * - Graceful fallback responses
 */

const axios = require('axios');
const crypto = require('crypto');

class AIService {
  constructor() {
    this.baseURL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
    this.secret = process.env.AI_SERVICE_SECRET || '';
    this.timeout = parseInt(process.env.AI_REQUEST_TIMEOUT) || 10000;
    this.maxRetries = parseInt(process.env.AI_MAX_RETRIES) || 3;

    // Circuit breaker state
    this.failures = 0;
    this.circuitOpen = false;
    this.circuitOpenTime = null;
    this.circuitResetTimeout = 30000; // 30 seconds

    // Response cache (simple in-memory)
    this.cache = new Map();
    this.cacheTTL = 60000; // 60 seconds

    // Create axios instance
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  // ========================================================================
  // Core HTTP Methods
  // ========================================================================

  /**
   * Sign a request with HMAC for security
   */
  _signRequest(body) {
    if (!this.secret) return '';
    const payload = JSON.stringify(body || {});
    return crypto.createHmac('sha256', this.secret).update(payload).digest('hex');
  }

  /**
   * Check if circuit breaker allows requests
   */
  _isCircuitOpen() {
    if (!this.circuitOpen) return false;

    // Check if enough time has passed to try again
    const elapsed = Date.now() - this.circuitOpenTime;
    if (elapsed > this.circuitResetTimeout) {
      this.circuitOpen = false;
      this.failures = 0;
      console.log('[AI Service] Circuit breaker reset — retrying AI module');
      return false;
    }

    return true;
  }

  /**
   * Record a failure for circuit breaker
   */
  _recordFailure() {
    this.failures++;
    if (this.failures >= 5) {
      this.circuitOpen = true;
      this.circuitOpenTime = Date.now();
      console.error('[AI Service] Circuit breaker OPEN — AI module appears down');
    }
  }

  /**
   * Record a success — reset failure counter
   */
  _recordSuccess() {
    this.failures = 0;
    this.circuitOpen = false;
  }

  /**
   * Make a request with retry logic
   */
  async _request(method, endpoint, data = null, options = {}) {
    // Check circuit breaker
    if (this._isCircuitOpen()) {
      return this._fallbackResponse('AI assistant is temporarily unavailable. Please try again in a moment.');
    }

    const retries = options.retries || this.maxRetries;
    const timeoutMs = options.timeout || this.timeout;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const signature = this._signRequest(data);
        const config = {
          method,
          url: endpoint,
          timeout: timeoutMs,
          headers: {
            'X-AI-Service-Key': this.secret,
            'X-Request-Signature': signature,
            'X-Timestamp': Date.now().toString(),
          },
        };

        if (method === 'get') {
          config.params = data;
        } else {
          config.data = data;
        }

        const response = await this.client(config);
        this._recordSuccess();
        return { success: true, data: response.data };

      } catch (error) {
        const isLastRetry = attempt === retries;
        const status = error.response?.status;

        // Don't retry on client errors (4xx) — only on server errors (5xx) and network issues
        if (status && status >= 400 && status < 500) {
          return {
            success: false,
            error: error.response?.data?.detail || error.message,
            status,
          };
        }

        if (isLastRetry) {
          console.error(`[AI Service] All ${retries} attempts failed for ${endpoint}:`, error.message);
          this._recordFailure();
          return this._fallbackResponse('AI assistant could not process your request. Please try again.');
        }

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.warn(`[AI Service] Attempt ${attempt}/${retries} failed for ${endpoint}, retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Generate a fallback response when AI is unavailable
   */
  _fallbackResponse(message) {
    return {
      success: false,
      data: {
        status: 'failed',
        agent_type: 'system',
        intent: 'unknown',
        response: message,
        data: null,
        reasoning: 'AI service unavailable — fallback response',
        requires_confirmation: false,
        timestamp: new Date().toISOString(),
      },
      error: message,
    };
  }

  // ========================================================================
  // Cache Helpers
  // ========================================================================

  _getCached(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.time > this.cacheTTL) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  _setCache(key, data) {
    this.cache.set(key, { data, time: Date.now() });
    // Cleanup old entries
    if (this.cache.size > 100) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
  }

  // ========================================================================
  // Public API Methods
  // ========================================================================

  /**
   * Send a chat query to the AI
   */
  async chat(query, shopId, userId, sessionId, isVoice = false) {
    return this._request('post', '/api/chat', {
      query,
      shop_id: shopId,
      user_id: userId,
      session_id: sessionId,
      is_voice: isVoice,
    });
  }

  /**
   * Process voice billing command
   */
  async voiceBilling(audioText, shopId, currentBillId = null) {
    return this._request('post', '/api/billing/voice', {
      audio_text: audioText,
      shop_id: shopId,
      current_bill_id: currentBillId,
    });
  }

  /**
   * Confirm or cancel a pending billing action
   */
  async confirmBilling(confirmed = true) {
    return this._request('post', '/api/billing/confirm', { confirmed });
  }

  /**
   * Analyze stock for reorder recommendation
   */
  async analyzeStock(productName, shopId, productId = null) {
    return this._request('post', '/api/stock/analyze', {
      product_name: productName,
      product_id: productId,
      shop_id: shopId,
    });
  }

  /**
   * Approve or reject a reorder draft
   */
  async approveReorder(draftOrderId, approved, modifiedQuantity = null) {
    return this._request('post', '/api/stock/approve', {
      draft_order_id: draftOrderId,
      approved,
      modified_quantity: modifiedQuantity,
    });
  }

  /**
   * Generate a narrated report
   */
  async narrateReport(reportType, shopId, startDate = null, endDate = null) {
    return this._request('post', '/api/reports/narrate', {
      report_type: reportType,
      shop_id: shopId,
      start_date: startDate,
      end_date: endDate,
    }, { timeout: 30000 }); // Reports may take longer
  }

  /**
   * Get sales forecast
   */
  async getForecast(productOrCategory = null) {
    const cacheKey = `forecast_${productOrCategory}`;
    const cached = this._getCached(cacheKey);
    if (cached) return cached;

    const result = await this._request('get', '/api/insights/forecast', {
      product_or_category: productOrCategory,
    });

    if (result.success) this._setCache(cacheKey, result);
    return result;
  }

  /**
   * Check for anomalies
   */
  async checkAnomalies(transactionId = null) {
    return this._request('get', '/api/insights/anomalies', {
      transaction_id: transactionId,
    });
  }

  /**
   * Get staff performance report
   */
  async getStaffPerformance(userId = null, role = null, period = 'weekly') {
    return this._request('get', '/api/staff/performance', {
      user_id: userId,
      role,
      period,
    });
  }

  /**
   * Health check — is the AI module running?
   */
  async healthCheck() {
    try {
      const result = await this._request('get', '/api/health', null, {
        retries: 1,
        timeout: 5000,
      });
      return result;
    } catch {
      return { success: false, error: 'AI module unreachable' };
    }
  }

  /**
   * Reset all AI agent contexts
   */
  async resetContext() {
    return this._request('post', '/api/reset');
  }
}

// Export singleton instance
module.exports = new AIService();
