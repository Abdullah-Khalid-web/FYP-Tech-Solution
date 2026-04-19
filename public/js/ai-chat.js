/**
 * AI Chat Widget
 * Floating chat panel for AI-powered assistance on all authenticated pages.
 * 
 * Features:
 * - Floating toggle button (bottom-right)
 * - Chat message history
 * - Text input with send
 * - Voice input (Web Speech API)
 * - Typing indicator
 * - Session persistence
 * - Quick action buttons
 */

(function () {
  'use strict';

  // ========================================================================
  // Configuration
  // ========================================================================

  const AI_CHAT_API = '/api/ai/chat';
  const AI_HEALTH_API = '/api/ai/health';
  const AI_RESET_API = '/api/ai/reset';
  const SESSION_KEY = 'managehub_ai_chat_history';
  const MAX_HISTORY = 50;

  // ========================================================================
  // State
  // ========================================================================

  let isOpen = false;
  let isLoading = false;
  let messages = [];
  let recognition = null; // Speech recognition instance

  // ========================================================================
  // Initialization
  // ========================================================================

  function init() {
    createWidget();
    loadHistory();
    renderMessages();
    setupSpeechRecognition();
  }

  // ========================================================================
  // Create DOM Elements
  // ========================================================================

  function createWidget() {
    // --- Floating Toggle Button ---
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'ai-chat-toggle';
    toggleBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="currentColor" class="bi bi-robot" viewBox="0 0 16 16">
        <path d="M6 12.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5M3 8.062C3 6.76 4.235 5.765 5.53 5.889a28.02 28.02 0 0 1 4.94 0C11.765 5.765 13 6.76 13 8.062v1.157a.933.933 0 0 1-.765.935c-.845.147-2.34.346-4.235.346-1.895 0-3.39-.2-4.235-.346A.933.933 0 0 1 3 9.219zm4.542-.827a.25.25 0 0 0-.217.068l-.92.9a25 25 0 0 1-1.871-.183.25.25 0 0 0-.068.495c.55.076 1.232.149 2.02.193a.25.25 0 0 0 .189-.071l.754-.736.847 1.71a.25.25 0 0 0 .404.062l.932-.97a25 25 0 0 0 1.922-.188.25.25 0 0 0-.068-.495c-.538.074-1.207.145-1.98.189a.25.25 0 0 0-.166.076l-.754.785-.842-1.7a.25.25 0 0 0-.182-.135Z"/>
        <path d="M8.5 1.866a1 1 0 1 0-1 0V3h-2A4.5 4.5 0 0 0 1 7.5V8a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1v1a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1v-.5A4.5 4.5 0 0 0 10.5 3h-2zM14 7.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7.5A3.5 3.5 0 0 1 5.5 4h5A3.5 3.5 0 0 1 14 7.5"/>
      </svg>
      <span class="ai-badge" id="ai-badge" style="display:none">!</span>
    `;
    toggleBtn.title = 'AI Assistant';
    toggleBtn.addEventListener('click', toggleChat);
    document.body.appendChild(toggleBtn);

    // --- Chat Panel ---
    const panel = document.createElement('div');
    panel.id = 'ai-chat-panel';
    panel.className = 'ai-chat-panel';
    panel.innerHTML = `
      <div class="ai-chat-header">
        <div class="ai-chat-header-info">
          <div class="ai-avatar">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
            </svg>
          </div>
          <div>
            <h4>AI Assistant</h4>
            <span class="ai-status" id="ai-status">Connecting...</span>
          </div>
        </div>
        <div class="ai-chat-header-actions">
          <button id="ai-reset-btn" title="Reset conversation" class="ai-header-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="1 4 1 10 7 10"></polyline>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
            </svg>
          </button>
          <button id="ai-close-btn" title="Close" class="ai-header-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      <div class="ai-chat-messages" id="ai-chat-messages">
        <!-- Messages rendered here -->
      </div>

      <div class="ai-quick-actions" id="ai-quick-actions">
        <button class="ai-quick-btn" data-query="What is today's total sale?">📊 Today's Sales</button>
        <button class="ai-quick-btn" data-query="Which items are low on stock?">📦 Low Stock</button>
        <button class="ai-quick-btn" data-query="Show me this week's report">📋 Weekly Report</button>
        <button class="ai-quick-btn" data-query="Who is the top performing staff?">👥 Staff Performance</button>
      </div>

      <div class="ai-chat-input-area">
        <button id="ai-voice-btn" title="Voice input" class="ai-voice-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
        </button>
        <input type="text" id="ai-chat-input" placeholder="Ask me anything..." autocomplete="off">
        <button id="ai-send-btn" title="Send" class="ai-send-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    `;
    document.body.appendChild(panel);

    // --- Event Listeners ---
    document.getElementById('ai-close-btn').addEventListener('click', toggleChat);
    document.getElementById('ai-send-btn').addEventListener('click', sendMessage);
    document.getElementById('ai-reset-btn').addEventListener('click', resetConversation);
    document.getElementById('ai-voice-btn').addEventListener('click', toggleVoice);

    const input = document.getElementById('ai-chat-input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Quick action buttons
    document.querySelectorAll('.ai-quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const query = btn.getAttribute('data-query');
        document.getElementById('ai-chat-input').value = query;
        sendMessage();
      });
    });

    // Check AI health
    checkHealth();
  }

  // ========================================================================
  // Chat Logic
  // ========================================================================

  function toggleChat() {
    isOpen = !isOpen;
    const panel = document.getElementById('ai-chat-panel');
    const toggle = document.getElementById('ai-chat-toggle');

    if (isOpen) {
      panel.classList.add('open');
      toggle.classList.add('active');
      document.getElementById('ai-chat-input').focus();
      document.getElementById('ai-badge').style.display = 'none';

      // Show welcome message if no history
      if (messages.length === 0) {
        addMessage('assistant', 'Hello! 👋 I\'m your AI assistant. I can help you with:\n\n• Check sales & revenue\n• View inventory & low stock\n• Generate reports\n• Analyze staff performance\n• Voice-powered billing\n\nHow can I help you today?');
      }
    } else {
      panel.classList.remove('open');
      toggle.classList.remove('active');
    }
  }

  async function sendMessage() {
    const input = document.getElementById('ai-chat-input');
    const query = input.value.trim();

    if (!query || isLoading) return;

    // Add user message
    addMessage('user', query);
    input.value = '';

    // Show typing indicator
    showTyping();

    try {
      const response = await fetch(AI_CHAT_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      hideTyping();

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        addMessage('assistant', extractText(err.response) || extractText(err.error) || 'Sorry, something went wrong. Please try again.');
        return;
      }

      const data = await response.json();
      console.log('[AI Chat] Raw response data:', JSON.stringify(data).substring(0, 500));

      // Extract the response text — handle every possible format
      let text = extractText(data.response);

      // If still empty, try other fields
      if (!text) text = extractText(data.message);
      if (!text) text = extractText(data.output);
      if (!text && data.error) text = '⚠️ ' + extractText(data.error);
      if (!text) text = 'I received your request but couldn\'t generate a response.';

      // If there's structured data, append it
      if (data.data && typeof data.data === 'object' && !data.data.action) {
        const dataStr = formatData(data.data);
        if (dataStr) text += '\n\n' + dataStr;
      }

      // If confirmation is needed
      if (data.requires_confirmation) {
        text += '\n\n⚠️ _This action requires your confirmation._';
      }

      addMessage('assistant', text, data);

    } catch (err) {
      hideTyping();
      console.error('[AI Chat] Error:', err);
      addMessage('assistant', 'Could not reach the AI assistant. Please make sure the AI module is running.');
    }
  }

  function addMessage(role, content, metadata = null) {
    const msg = {
      role,
      content,
      timestamp: new Date().toISOString(),
      metadata,
    };

    messages.push(msg);

    // Trim history
    if (messages.length > MAX_HISTORY) {
      messages = messages.slice(-MAX_HISTORY);
    }

    saveHistory();
    renderMessages();
  }

  function renderMessages() {
    const container = document.getElementById('ai-chat-messages');
    if (!container) return;

    container.innerHTML = messages.map(msg => {
      const isUser = msg.role === 'user';
      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      // Use extractText to safely handle any content type
      const rawContent = extractText(msg.content) || '(empty message)';
      const content = escapeHtml(rawContent).replace(/\n/g, '<br>');

      return `
        <div class="ai-msg ${isUser ? 'ai-msg-user' : 'ai-msg-assistant'}">
          <div class="ai-msg-bubble">
            <div class="ai-msg-content">${content}</div>
            <div class="ai-msg-time">${time}</div>
          </div>
        </div>
      `;
    }).join('');

    // Auto-scroll
    container.scrollTop = container.scrollHeight;

    // Hide quick actions if there are messages
    const quickActions = document.getElementById('ai-quick-actions');
    if (quickActions) {
      quickActions.style.display = messages.length > 1 ? 'none' : 'flex';
    }
  }

  function showTyping() {
    isLoading = true;
    const container = document.getElementById('ai-chat-messages');
    const typing = document.createElement('div');
    typing.id = 'ai-typing';
    typing.className = 'ai-msg ai-msg-assistant';
    typing.innerHTML = `
      <div class="ai-msg-bubble ai-typing-bubble">
        <div class="ai-typing-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
    `;
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
  }

  function hideTyping() {
    isLoading = false;
    const typing = document.getElementById('ai-typing');
    if (typing) typing.remove();
  }

  // ========================================================================
  // Voice Input
  // ========================================================================

  function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      const voiceBtn = document.getElementById('ai-voice-btn');
      if (voiceBtn) voiceBtn.style.display = 'none';
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      document.getElementById('ai-chat-input').value = transcript;
      sendMessage();
    };

    recognition.onerror = (event) => {
      console.warn('[AI Chat] Speech recognition error:', event.error);
      const voiceBtn = document.getElementById('ai-voice-btn');
      voiceBtn.classList.remove('listening');
    };

    recognition.onend = () => {
      const voiceBtn = document.getElementById('ai-voice-btn');
      voiceBtn.classList.remove('listening');
    };
  }

  function toggleVoice() {
    if (!recognition) return;

    const voiceBtn = document.getElementById('ai-voice-btn');

    if (voiceBtn.classList.contains('listening')) {
      recognition.stop();
      voiceBtn.classList.remove('listening');
    } else {
      recognition.start();
      voiceBtn.classList.add('listening');
    }
  }

  // ========================================================================
  // Utility
  // ========================================================================

  async function checkHealth() {
    try {
      const res = await fetch(AI_HEALTH_API);
      const data = await res.json();
      const status = document.getElementById('ai-status');
      if (data.ai_module === 'connected') {
        status.textContent = 'Online';
        status.className = 'ai-status online';
      } else {
        status.textContent = 'AI Offline';
        status.className = 'ai-status offline';
      }
    } catch {
      const status = document.getElementById('ai-status');
      status.textContent = 'Offline';
      status.className = 'ai-status offline';
    }
  }

  async function resetConversation() {
    messages = [];
    saveHistory();
    renderMessages();
    try {
      await fetch(AI_RESET_API, { method: 'POST' });
    } catch { /* ignore */ }
    addMessage('assistant', 'Conversation reset. How can I help you?');
  }

  /**
   * Deeply extract readable text from any value.
   * Handles: plain strings, arrays of content-block objects,
   * nested objects with text/content/message fields, etc.
   * Returns a plain string or '' if nothing is found.
   */
  function extractText(val) {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val.trim();
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);

    if (Array.isArray(val)) {
      const parts = val.map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          // Try every common key that might hold text
          return item.text || item.content || item.message || item.response || item.value || '';
        }
        return String(item);
      }).filter(Boolean);
      return parts.join(' ').trim();
    }

    if (typeof val === 'object') {
      // Try common text-holding keys
      const textKeys = ['text', 'content', 'message', 'response', 'value', 'output'];
      for (const key of textKeys) {
        if (val[key] && typeof val[key] === 'string') return val[key].trim();
      }
      // Last resort: JSON stringify but make it readable
      try {
        return JSON.stringify(val);
      } catch {
        return String(val);
      }
    }

    return String(val);
  }

  function formatData(data) {
    if (!data || typeof data !== 'object') return '';
    const parts = [];
    for (const [key, val] of Object.entries(data)) {
      if (key === 'action') continue;
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      if (typeof val === 'number') {
        parts.push(`📌 ${label}: ${val.toLocaleString()}`);
      } else if (Array.isArray(val)) {
        parts.push(`📌 ${label}: ${val.length} items`);
      }
    }
    return parts.join('\n');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function saveHistory() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(messages));
    } catch { /* storage full — ignore */ }
  }

  function loadHistory() {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Sanitize old cached messages — ensure every content is a string
        messages = parsed.map(msg => {
          if (typeof msg.content !== 'string') {
            msg.content = extractText(msg.content) || '(message could not be displayed)';
          }
          return msg;
        });
      }
    } catch { messages = []; }
  }

  // ========================================================================
  // Boot
  // ========================================================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
