"""
Agent #7: Smart Report Narration Agent
Purpose: Convert structured reports into human-readable narratives.
"""

from typing import List, Dict, Any, Optional
from .base_agent import BaseAgent
from schemas import IntentType, AgentType, ActionStatus, NarratedReport
from tools import REPORT_AGENT_TOOLS


REPORT_AGENT_PROMPT = """You are a business report narrator that converts data into executive-friendly summaries.
Your role is to explain reports in clear, actionable language.

RESPONSE FORMAT:
📊 [Report Type] Summary - [Period]
**Key Highlights:** - metrics with comparisons
**Trends:** - observations
**Recommendations:** - actionable advice

Shop ID: {shop_id}
"""


class ReportAgent(BaseAgent):
    """Smart Report Narration Agent."""
    
    def __init__(self, shop_id: int = None):
        super().__init__(
            agent_type=AgentType.REPORT_AGENT,
            tools=REPORT_AGENT_TOOLS,
            system_prompt=REPORT_AGENT_PROMPT,
            shop_id=shop_id
        )
    
    async def reason(self, perceived_input: Dict) -> tuple:
        normalized = perceived_input.get("normalized_input", "")
        if any(kw in normalized for kw in ["report", "summary", "explain", "overview"]):
            return IntentType.REPORT_QUERY, ["daily_report"]
        return IntentType.UNKNOWN, []
    
    async def plan(self, intent: IntentType, data_needs: List[str]) -> Dict:
        return {"intent": intent, "tools_to_use": ["get_daily_report", "get_weekly_report"]}
    
    async def narrate_report(
        self, report_type: str = "daily", start_date: Optional[str] = None, end_date: Optional[str] = None
    ) -> NarratedReport:
        query = f"Generate a {report_type} report narrative"
        
        try:
            result = await self.act({}, {"original_input": query})
            return NarratedReport(
                status=ActionStatus.SUCCESS,
                report_type=report_type,
                period=f"{start_date} to {end_date}" if start_date else "current",
                executive_summary=result.get("output", ""),
                key_metrics={},
                trends=[],
                alerts=[],
                recommendations=[]
            )
        except Exception as e:
            return NarratedReport(
                status=ActionStatus.FAILED,
                report_type=report_type,
                period="unknown",
                executive_summary=f"Error: {str(e)}",
                key_metrics={},
                trends=[],
                alerts=[],
                recommendations=[]
            )
