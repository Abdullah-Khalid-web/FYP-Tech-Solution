"""
Pydantic schemas for request/response validation.
These define the data structures for AI agent interactions.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum
from datetime import datetime


# =============================================================================
# Enums
# =============================================================================

class IntentType(str, Enum):
    """Classified intent types for user queries."""
    SALES_QUERY = "sales_query"
    INVENTORY_QUERY = "inventory_query"
    BILLING_ACTION = "billing_action"
    REORDER_ACTION = "reorder_action"
    STAFF_QUERY = "staff_query"
    REPORT_QUERY = "report_query"
    FORECAST_QUERY = "forecast_query"
    ANOMALY_QUERY = "anomaly_query"
    EXPENSE_QUERY = "expense_query"
    UNKNOWN = "unknown"


class AgentType(str, Enum):
    """Available agent types in the system."""
    RETAIL_ASSISTANT = "retail_assistant"
    BILLING_AGENT = "billing_agent"
    STOCK_AGENT = "stock_agent"
    FORECAST_AGENT = "forecast_agent"
    ANOMALY_AGENT = "anomaly_agent"
    STAFF_AGENT = "staff_agent"
    REPORT_AGENT = "report_agent"


class ActionStatus(str, Enum):
    """Status of agent actions."""
    SUCCESS = "success"
    PENDING_APPROVAL = "pending_approval"
    FAILED = "failed"
    NEEDS_CLARIFICATION = "needs_clarification"


# =============================================================================
# Request Schemas
# =============================================================================

class UserQuery(BaseModel):
    """Input from user (text or transcribed voice)."""
    query: str = Field(..., description="User's natural language query")
    shop_id: int = Field(default=24, description="Shop ID for multi-tenant support")
    user_id: Optional[int] = Field(None, description="ID of the user making the query")
    session_id: Optional[str] = Field(None, description="Session ID for conversation context")
    is_voice: bool = Field(default=False, description="Whether the query came from voice input")


class VoiceBillingRequest(BaseModel):
    """Voice billing command request."""
    audio_text: str = Field(..., description="Transcribed audio text")
    shop_id: int = Field(default=24)
    current_bill_id: Optional[int] = Field(None, description="Current active bill ID")


class ReorderRequest(BaseModel):
    """Stock reorder request."""
    product_id: Optional[int] = Field(None)
    product_name: Optional[str] = Field(None)
    shop_id: int = Field(default=24)


class ReorderApproval(BaseModel):
    """Human approval for reorder action."""
    draft_order_id: int
    approved: bool
    modified_quantity: Optional[int] = Field(None, description="Modified quantity if user changes suggestion")
    notes: Optional[str] = Field(None)


class ReportRequest(BaseModel):
    """Report narration request."""
    report_type: str = Field(..., description="Type: daily, weekly, monthly, profit_loss, inventory")
    shop_id: int = Field(default=24)
    start_date: Optional[str] = Field(None)
    end_date: Optional[str] = Field(None)


# =============================================================================
# Response Schemas
# =============================================================================

class AgentResponse(BaseModel):
    """Standard response from any agent."""
    status: ActionStatus
    agent_type: AgentType
    intent: IntentType
    response: str = Field(..., description="Human-friendly response text")
    data: Optional[Dict[str, Any]] = Field(None, description="Structured data if applicable")
    reasoning: Optional[str] = Field(None, description="Explanation of agent's reasoning")
    action_taken: Optional[str] = Field(None, description="Description of action taken")
    requires_confirmation: bool = Field(default=False)
    timestamp: datetime = Field(default_factory=datetime.now)


class BillingResponse(BaseModel):
    """Response for billing operations."""
    status: ActionStatus
    message: str
    item_added: Optional[Dict[str, Any]] = None
    current_bill_total: Optional[float] = None
    requires_confirmation: bool = True
    confirmation_prompt: Optional[str] = None


class ReorderRecommendation(BaseModel):
    """Stock reorder recommendation (requires human approval)."""
    status: ActionStatus = ActionStatus.PENDING_APPROVAL
    product_id: int
    product_name: str
    current_stock: int
    min_stock_threshold: int
    suggested_quantity: int
    reasoning: str
    estimated_cost: Optional[float] = None
    supplier_info: Optional[Dict[str, Any]] = None
    draft_order_id: Optional[int] = None
    awaiting_approval: bool = True


class ForecastInsight(BaseModel):
    """Forecasting and insight response."""
    status: ActionStatus
    product_or_category: str
    trend: str  # "increasing", "decreasing", "stable"
    percentage_change: float
    period: str  # "daily", "weekly", "monthly"
    insight: str
    recommendation: Optional[str] = None
    data_points: Optional[List[Dict[str, Any]]] = None


class AnomalyReport(BaseModel):
    """Anomaly detection report."""
    status: ActionStatus
    anomaly_type: str  # "high_discount", "unusual_void", "time_anomaly", etc.
    severity: str  # "low", "medium", "high"
    description: str
    affected_transaction_id: Optional[int] = None
    comparison_data: Optional[Dict[str, Any]] = None
    recommendation: str
    flagged_for_review: bool = False


class StaffPerformanceReport(BaseModel):
    """Staff performance summary."""
    status: ActionStatus
    user_id: int
    user_name: str
    role: str
    metrics: Dict[str, Any]
    comparison_to_average: Dict[str, Any]
    guidance: str
    period: str


class NarratedReport(BaseModel):
    """Narrated report response."""
    status: ActionStatus
    report_type: str
    period: str
    executive_summary: str
    key_metrics: Dict[str, Any]
    trends: List[str]
    alerts: List[str]
    recommendations: List[str]


# =============================================================================
# Tool Schemas (for LangChain tool definitions)
# =============================================================================

class ToolInput(BaseModel):
    """Base tool input schema."""
    shop_id: int = 24


class SalesQueryInput(ToolInput):
    """Input for sales query tools."""
    date: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    category: Optional[str] = None


class InventoryQueryInput(ToolInput):
    """Input for inventory query tools."""
    product_id: Optional[int] = None
    product_name: Optional[str] = None
    category: Optional[str] = None


class BillingActionInput(ToolInput):
    """Input for billing action tools."""
    product_name: str
    quantity: int = 1
    bill_id: Optional[int] = None


class StaffQueryInput(ToolInput):
    """Input for staff query tools."""
    user_id: Optional[int] = None
    role: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
