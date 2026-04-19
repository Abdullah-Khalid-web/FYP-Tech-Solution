"""
Agent #6: Staff Performance & Guidance Agent
Purpose: Staff analytics and improvement guidance.
NOTE: Provides guidance, NOT enforcement.
"""

from typing import List, Dict, Any, Optional
from .base_agent import BaseAgent
from schemas import IntentType, AgentType, ActionStatus, StaffPerformanceReport
from tools import STAFF_AGENT_TOOLS


STAFF_AGENT_PROMPT = """You are a staff analytics assistant that provides performance insights.
Your role is to help managers understand staff performance and provide constructive feedback.

CRITICAL RULES:
1. Provide GUIDANCE, not enforcement
2. Be constructive, never accusatory
3. Highlight strengths alongside areas for improvement

Shop ID: {shop_id}
"""


class StaffAgent(BaseAgent):
    """Staff Performance & Guidance Agent."""
    
    def __init__(self, shop_id: int = None):
        super().__init__(
            agent_type=AgentType.STAFF_AGENT,
            tools=STAFF_AGENT_TOOLS,
            system_prompt=STAFF_AGENT_PROMPT,
            shop_id=shop_id
        )
    
    async def reason(self, perceived_input: Dict) -> tuple:
        normalized = perceived_input.get("normalized_input", "")
        if any(kw in normalized for kw in ["cashier", "employee", "staff", "performance"]):
            return IntentType.STAFF_QUERY, ["team_metrics"]
        return IntentType.UNKNOWN, []
    
    async def plan(self, intent: IntentType, data_needs: List[str]) -> Dict:
        return {"intent": intent, "tools_to_use": ["get_staff_performance_metrics", "get_cashier_activity"]}
    
    async def get_performance_report(
        self, user_id: int = None, role: str = None, period: str = "weekly"
    ) -> StaffPerformanceReport:
        query = f"Analyze performance for staff {user_id or 'team'} over {period}"
        
        try:
            result = await self.act({}, {"original_input": query})
            return StaffPerformanceReport(
                status=ActionStatus.SUCCESS,
                user_id=user_id or 0,
                user_name="Team" if not user_id else f"Staff #{user_id}",
                role=role or "all",
                metrics={},
                comparison_to_average={},
                guidance=result.get("output", ""),
                period=period
            )
        except Exception as e:
            return StaffPerformanceReport(
                status=ActionStatus.FAILED,
                user_id=user_id or 0,
                user_name="Unknown",
                role=role or "unknown",
                metrics={},
                comparison_to_average={},
                guidance=f"Error: {str(e)}",
                period=period
            )
