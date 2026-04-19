# Retail Agentic AI Service

A centralized Agentic AI service for Retail Management SaaS that autonomously interprets user intent, reasons over retail data, and invokes backend services to provide conversational interaction, voice-based billing, decision support, and explainable insights while maintaining human oversight for critical operations.

## 🏗️ Architecture

```
User → Frontend → Agentic AI → Backend APIs → Agentic AI → Frontend → User
```

## 🤖 Agents

| # | Agent | Purpose |
|---|-------|---------|
| 1 | Retail Assistant | Natural language queries (sales, inventory) |
| 2 | Billing Agent | Voice-enabled billing with confirmation |
| 3 | Stock Agent | Reorder recommendations (requires approval) |
| 4 | Forecast Agent | Sales trends & insights |
| 5 | Anomaly Agent | Transaction analysis (no auto-blocking) |
| 6 | Staff Agent | Performance analytics & guidance |
| 7 | Report Agent | Executive report narration |

## 🚀 Quick Start

### 1. Install Dependencies
```bash
cd fyp
pip install -r requirements.txt
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
```

### 3. Run the Service
```bash
python main.py
# OR
uvicorn "main:app" --reload --port 8000
```

### 🧪 Terminal Test Mode (No Backend Required)
You can test the agents interactively in the terminal without running the backend server (Mock Mode):

```bash
python test_terminal.py
```
*Note: You still need an OpenAI API Key for the agents to function.*

### 4. Access API Docs
Open: http://localhost:8000/docs

## 📡 API Endpoints

### Main Chat
```
POST /api/chat
{
  "query": "What is today's total sale?",
  "shop_id": 24
}
```

### Voice Billing
```
POST /api/billing/voice
{
  "audio_text": "Add two milk packets",
  "shop_id": 24
}

POST /api/billing/confirm
{
  "confirmed": true
}
```

### Stock Reorder (Human-in-the-Loop)
```
POST /api/stock/analyze
{
  "product_name": "Rice",
  "shop_id": 24
}

POST /api/stock/approve
{
  "draft_order_id": 1,
  "approved": true
}
```

### Reports
```
POST /api/reports/narrate
{
  "report_type": "weekly",
  "shop_id": 24
}
```

## 🔒 Safety Rules

- ❌ No direct database access
- ❌ No autonomous financial decisions
- ❌ No automatic blocking/punishment
- ✅ Human approval for critical actions
- ✅ Explainable reasoning in all responses
- ✅ Auditable action logs

## 📁 Project Structure

```
fyp/
├── main.py                 # FastAPI application
├── config.py               # Settings & API endpoints
├── api_client.py           # Backend API HTTP client
├── agent_router.py         # Intent classification & routing
├── agents/
│   ├── base_agent.py       # 6-step agentic cycle
│   ├── retail_assistant.py # Agent #1
│   ├── billing_agent.py    # Agent #2
│   ├── stock_agent.py      # Agent #3
│   ├── forecast_agent.py   # Agent #4
│   ├── anomaly_agent.py    # Agent #5
│   ├── staff_agent.py      # Agent #6
│   └── report_agent.py     # Agent #7
├── tools/
│   └── retail_tools.py     # LangChain tool definitions
├── schemas/
│   └── models.py           # Pydantic models
└── requirements.txt
```

## 🔧 Backend API Requirements

The backend team must provide these endpoints:

| Category | Endpoints |
|----------|-----------|
| Sales | `/api/sales/daily`, `/api/sales/top-sellers` |
| Billing | `/api/billing/add-item`, `/api/billing/finalize` |
| Inventory | `/api/products`, `/api/products/low-stock` |
| Staff | `/api/users/performance`, `/api/users/{id}/logs` |
| Reports | `/api/reports/daily`, `/api/reports/weekly` |
| Analytics | `/api/analytics/trends`, `/api/analytics/anomalies` |

See `config.py` for complete endpoint mapping.

## 📜 License

Proprietary - FYP Project
