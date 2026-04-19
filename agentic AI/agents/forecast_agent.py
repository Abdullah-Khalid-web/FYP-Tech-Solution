"""
Agent #4: Lightweight Forecasting & Insight Agent
Purpose: Short-term sales insights using rule-based analytics.
Features: Moving averages, trend comparisons, explainable forecasts.
"""

from typing import List, Dict, Any
from .base_agent import BaseAgent
from schemas import IntentType, AgentType, ActionStatus, ForecastInsight
from tools import FORECAST_AGENT_TOOLS


FORECAST_AGENT_PROMPT = """You are a retail analytics assistant specializing in sales forecasting.
You use simple statistical methods to provide actionable business insights.

CAPABILITIES:
- Calculate 7-day moving averages
- Compare week-over-week trends
- Identify seasonal patterns
- Provide business-friendly explanations

RESPONSE FORMAT:
1. Current Trend: [Up/Down/Stable] with percentage
2. Analysis: Brief explanation of the pattern
3. Insight: What this means for business
4. Recommendation: Actionable advice

Shop ID: {shop_id}
"""


class ForecastAgent(BaseAgent):
    """Lightweight Forecasting & Insight Agent."""
    
    def __init__(self, shop_id: int = None):
        super().__init__(
            agent_type=AgentType.FORECAST_AGENT,
            tools=FORECAST_AGENT_TOOLS,
            system_prompt=FORECAST_AGENT_PROMPT,
            shop_id=shop_id
        )
    
    async def reason(self, perceived_input: Dict) -> tuple:
        normalized = perceived_input.get("normalized_input", "")
        
        if any(kw in normalized for kw in ["predict", "forecast", "expect", "future", "next", "trend"]):
            return IntentType.FORECAST_QUERY, ["sales_trend", "historical_data"]
        return IntentType.UNKNOWN, []
    
    async def plan(self, intent: IntentType, data_needs: List[str]) -> Dict:
        return {"intent": intent, "tools_to_use": ["get_sales_trend", "get_weekly_sales"]}
    
    async def generate_insight(self, product_or_category: str = None) -> ForecastInsight:
        query = f"Analyze sales trend for {product_or_category or 'overall sales'}"
        
        try:
            result = await self.act({}, {"original_input": query})
            return ForecastInsight(
                status=ActionStatus.SUCCESS,
                product_or_category=product_or_category or "Overall",
                trend="analyzing",
                percentage_change=0.0,
                period="weekly",
                insight=result.get("output", "")
            )
        except Exception as e:
            return ForecastInsight(
                status=ActionStatus.FAILED,
                product_or_category=product_or_category or "Unknown",
                trend="unknown",
                percentage_change=0.0,
                period="unknown",
                insight=f"Error: {str(e)}"
            )
