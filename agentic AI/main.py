"""
Agentic AI Service - FastAPI Application
Centralized AI service for Retail Management SaaS.

This service:
- Receives user queries from frontend
- Routes to appropriate AI agents
- Calls backend APIs for data
- Returns human-friendly responses

Architecture: Frontend → Agentic AI (this) → Backend APIs → Agentic AI → Frontend
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from typing import Optional

from config import settings
from schemas import (
    UserQuery,
    VoiceBillingRequest,
    ReorderRequest,
    ReorderApproval,
    ReportRequest,
    AgentResponse,
    BillingResponse,
    ReorderRecommendation,
    NarratedReport,
    AgentType,
)
from agent_router import AgentRouter


# =============================================================================
# Application Lifecycle
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown events."""
    # Startup
    print("Starting Agentic AI Service...")
    print(f"Shop ID: {settings.DEFAULT_SHOP_ID}")
    print(f"LLM Model: {settings.LLM_MODEL}")
    print(f"Backend API: {settings.BACKEND_API_BASE_URL}")
    
    # Initialize router (lazy loading of agents)
    app.state.router = AgentRouter(shop_id=settings.DEFAULT_SHOP_ID)
    
    yield
    
    # Shutdown
    print("Shutting down Agentic AI Service...")


# =============================================================================
# FastAPI Application
# =============================================================================

app = FastAPI(
    title="Retail Agentic AI Service",
    description="""
    Centralized Agentic AI service that autonomously interprets user intent,
    reasons over retail data, and invokes backend services to provide:
    - Conversational interaction
    - Voice-based billing
    - Decision support
    - Explainable insights
    
    While maintaining human oversight for critical operations.
    """,
    version="1.0.0",
    lifespan=lifespan,
)

# CORS Middleware — restrict to allowed origins
allowed_origins = [o.strip() for o in settings.ALLOWED_ORIGINS.split(",")] if settings.ALLOWED_ORIGINS else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# API Key Verification Middleware
@app.middleware("http")
async def verify_api_key(request: Request, call_next):
    """Verify requests come from authorized backend service."""
    # Skip verification for health check and docs
    if request.url.path in ["/api/health", "/docs", "/openapi.json", "/redoc"]:
        return await call_next(request)
    
    # If secret is configured, verify it
    if settings.AI_SERVICE_SECRET:
        api_key = request.headers.get("x-ai-service-key", "")
        if api_key != settings.AI_SERVICE_SECRET:
            return JSONResponse(status_code=403, content={"detail": "Invalid service key"})
    
    return await call_next(request)


# Request Logging Middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all incoming requests."""
    if settings.VERBOSE_LOGGING:
        print(f"REQ: {request.method} {request.url.path}")
    response = await call_next(request)
    return response


# =============================================================================
# Main Chat Endpoint
# =============================================================================

@app.post("/api/chat", response_model=AgentResponse)
async def chat(query: UserQuery) -> AgentResponse:
    """
    Main endpoint for natural language queries.
    Routes to appropriate agent based on intent classification.
    
    Examples:
    - "What is today's total sale?"
    - "How much sugar is left in stock?"
    - "Which item sells the most?"
    """
    try:
        router = app.state.router
        response = await router.route(query)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Voice Billing Endpoints
# =============================================================================

@app.post("/api/billing/voice", response_model=BillingResponse)
async def voice_billing(request: VoiceBillingRequest) -> BillingResponse:
    """
    Process voice billing command.
    
    Example: "Add two milk packets"
    
    Returns confirmation prompt before executing.
    """
    try:
        router = app.state.router
        billing_agent = router.get_agent(AgentType.BILLING_AGENT)
        
        response = await billing_agent.process_with_confirmation(
            request.audio_text,
            confirmed=False
        )
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/billing/confirm", response_model=BillingResponse)
async def confirm_billing(confirmed: bool = True) -> BillingResponse:
    """
    Confirm or cancel pending billing action.
    """
    try:
        router = app.state.router
        billing_agent = router.get_agent(AgentType.BILLING_AGENT)
        
        if not confirmed:
            billing_agent.cancel_pending()
            return BillingResponse(
                status="cancelled",
                message="Billing action cancelled.",
                requires_confirmation=False
            )
        
        response = await billing_agent.process_with_confirmation("", confirmed=True)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Stock Reorder Endpoints
# =============================================================================

@app.post("/api/stock/analyze", response_model=ReorderRecommendation)
async def analyze_stock(request: ReorderRequest) -> ReorderRecommendation:
    """
    Analyze stock and get reorder recommendation.
    
    Returns a draft order requiring human approval.
    """
    try:
        router = app.state.router
        stock_agent = router.get_agent(AgentType.STOCK_AGENT)
        
        recommendation = await stock_agent.analyze_and_recommend(
            product_name=request.product_name,
            product_id=request.product_id
        )
        return recommendation
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/stock/approve")
async def approve_reorder(approval: ReorderApproval):
    """
    Approve or reject a pending reorder draft.
    
    ⚠️ This is the human-in-the-loop step.
    """
    try:
        router = app.state.router
        stock_agent = router.get_agent(AgentType.STOCK_AGENT)
        
        result = await stock_agent.approve_order(
            draft_id=approval.draft_order_id,
            approved=approval.approved,
            modified_quantity=approval.modified_quantity
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Report Endpoints
# =============================================================================

@app.post("/api/reports/narrate", response_model=NarratedReport)
async def narrate_report(request: ReportRequest) -> NarratedReport:
    """
    Generate a narrated report with executive summary.
    
    Example: "Explain this week's sales report"
    """
    try:
        router = app.state.router
        report_agent = router.get_agent(AgentType.REPORT_AGENT)
        
        response = await report_agent.narrate_report(
            report_type=request.report_type,
            start_date=request.start_date,
            end_date=request.end_date
        )
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Analytics Endpoints
# =============================================================================

@app.get("/api/insights/forecast")
async def get_forecast(product_or_category: Optional[str] = None):
    """
    Get sales forecast and insights.
    """
    try:
        router = app.state.router
        forecast_agent = router.get_agent(AgentType.FORECAST_AGENT)
        
        response = await forecast_agent.generate_insight(product_or_category)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/insights/anomalies")
async def check_anomalies(transaction_id: Optional[int] = None):
    """
    Check for anomalies in transactions.
    """
    try:
        router = app.state.router
        anomaly_agent = router.get_agent(AgentType.ANOMALY_AGENT)
        
        response = await anomaly_agent.analyze_transaction(transaction_id)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Staff Endpoints
# =============================================================================

@app.get("/api/staff/performance")
async def get_staff_performance(
    user_id: Optional[int] = None,
    role: Optional[str] = None,
    period: str = "weekly"
):
    """
    Get staff performance report with guidance.
    """
    try:
        router = app.state.router
        staff_agent = router.get_agent(AgentType.STAFF_AGENT)
        
        response = await staff_agent.get_performance_report(
            user_id=user_id,
            role=role,
            period=period
        )
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Utility Endpoints
# =============================================================================

@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    agents_status = {}
    try:
        router = app.state.router
        for agent_type, agent in router.agents.items():
            agents_status[agent_type.value] = "ready"
    except Exception:
        pass
    
    return {
        "status": "healthy",
        "service": "Agentic AI Service",
        "shop_id": settings.DEFAULT_SHOP_ID,
        "backend_url": settings.BACKEND_API_BASE_URL,
        "agents": agents_status,
        "model": settings.LLM_MODEL,
    }


@app.post("/api/reset")
async def reset_context():
    """Reset all agent conversation histories."""
    try:
        router = app.state.router
        router.clear_all_history()
        return {"status": "success", "message": "All agent contexts reset."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Run Application
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

