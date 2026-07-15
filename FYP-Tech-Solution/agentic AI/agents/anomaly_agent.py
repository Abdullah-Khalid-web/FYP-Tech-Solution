"""
Agent #5: Anomaly & Fraud Explanation Agent
Purpose: Explain unusual transactions without automatic blocking.
CRITICAL: No blocking or punishment. Only explains and suggests review.
"""

from typing import List, Dict, Any
from .base_agent import BaseAgent
from schemas import IntentType, AgentType, ActionStatus, AnomalyReport
from tools import ANOMALY_AGENT_TOOLS


ANOMALY_AGENT_PROMPT = """You are a transaction analysis assistant that identifies unusual patterns.
Your role is to detect anomalies and provide explanations, NOT to block or punish.

CRITICAL RULES:
1. NEVER automatically block transactions
2. NEVER punish or accuse staff
3. ONLY explain what you observe
4. ALWAYS suggest manual review

Shop ID: {shop_id}
"""


class AnomalyAgent(BaseAgent):
    """Anomaly & Fraud Explanation Agent."""
    
    def __init__(self, shop_id: int = None):
        super().__init__(
            agent_type=AgentType.ANOMALY_AGENT,
            tools=ANOMALY_AGENT_TOOLS,
            system_prompt=ANOMALY_AGENT_PROMPT,
            shop_id=shop_id
        )
    
    async def reason(self, perceived_input: Dict) -> tuple:
        normalized = perceived_input.get("normalized_input", "")
        if any(kw in normalized for kw in ["unusual", "suspicious", "fraud", "strange", "abnormal"]):
            return IntentType.ANOMALY_QUERY, ["transaction_history", "discount_patterns"]
        return IntentType.UNKNOWN, []
    
    async def plan(self, intent: IntentType, data_needs: List[str]) -> Dict:
        return {"intent": intent, "tools_to_use": ["get_discount_usage_patterns", "get_detected_anomalies"]}
    
    async def analyze_transaction(self, transaction_id: int = None) -> AnomalyReport:
        query = f"Check for anomalies in transaction {transaction_id}" if transaction_id else "List detected anomalies"
        
        try:
            result = await self.act({}, {"original_input": query})
            return AnomalyReport(
                status=ActionStatus.SUCCESS,
                anomaly_type="analysis",
                severity="medium",
                description=result.get("output", ""),
                recommendation="Consider manual review.",
                flagged_for_review=False
            )
        except Exception as e:
            return AnomalyReport(
                status=ActionStatus.FAILED,
                anomaly_type="error",
                severity="low",
                description=f"Error: {str(e)}",
                recommendation="Please try again.",
                flagged_for_review=False
            )
