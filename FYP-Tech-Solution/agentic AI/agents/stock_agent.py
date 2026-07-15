"""
Agent #3: Human-in-the-Loop Stock Ordering Agent
Purpose: Stock reorder recommendations with MANDATORY human approval.

CRITICAL: No automatic purchasing allowed. All orders require human approval.
"""

from typing import List, Dict, Any, Optional
from .base_agent import BaseAgent
from schemas import IntentType, AgentType, ActionStatus, ReorderRecommendation
from tools import STOCK_AGENT_TOOLS


STOCK_AGENT_PROMPT = """You are a stock management assistant that helps with inventory reordering.
Your role is to analyze stock levels and RECOMMEND reorders, but NEVER execute them automatically.

CAPABILITIES:
- Check current stock levels
- Analyze sales history to predict needs
- Calculate optimal reorder quantities
- Create draft orders for human approval

CRITICAL RULES:
1. NEVER place an order automatically
2. ALWAYS create a DRAFT order that requires human approval
3. Explain your reasoning for the suggested quantity
4. Include cost estimates when possible
5. Mention supplier information if available

RESPONSE FORMAT:
1. Current Stock: [X] units
2. Minimum Threshold: [Y] units
3. Sales Analysis: [Brief trend]
4. Suggested Reorder: [Z] units
5. Estimated Cost: [Amount]
6. ⚠️ AWAITING YOUR APPROVAL

Shop ID: {shop_id}
"""


class StockOrderingAgent(BaseAgent):
    """
    Human-in-the-Loop Stock Ordering Agent.
    Creates reorder recommendations that require human approval.
    """
    
    def __init__(self, shop_id: int = None):
        super().__init__(
            agent_type=AgentType.STOCK_AGENT,
            tools=STOCK_AGENT_TOOLS,
            system_prompt=STOCK_AGENT_PROMPT,
            shop_id=shop_id
        )
        self.pending_orders: Dict[int, ReorderRecommendation] = {}
    
    async def reason(self, perceived_input: Dict) -> tuple:
        """
        Determine if this is a reorder request.
        """
        normalized = perceived_input.get("normalized_input", "")
        
        is_reorder = any(kw in normalized for kw in [
            "reorder", "order", "stock up", "buy", "purchase", "replenish", "should i"
        ])
        
        if is_reorder:
            intent = IntentType.REORDER_ACTION
            data_needs = ["current_stock", "sales_history", "supplier_info"]
        else:
            intent = IntentType.INVENTORY_QUERY
            data_needs = ["stock_levels"]
        
        return intent, data_needs
    
    async def plan(self, intent: IntentType, data_needs: List[str]) -> Dict:
        """
        Plan stock analysis and draft order creation.
        """
        return {
            "intent": intent,
            "tools_to_use": [
                "get_low_stock_items",
                "get_product_stock",
                "get_sales_trend",
                "create_reorder_draft"
            ],
            "requires_approval": True,
            "action": "create_draft_only"
        }
    
    async def analyze_and_recommend(
        self, 
        product_name: Optional[str] = None,
        product_id: Optional[int] = None
    ) -> ReorderRecommendation:
        """
        Analyze stock and create a reorder recommendation.
        Returns a draft that requires human approval.
        """
        try:
            # Use agent to gather data and generate recommendation
            query = f"Analyze stock for {product_name or f'product {product_id}'} and recommend reorder quantity"
            
            result = await self.act({}, {"original_input": query})
            
            # Create draft recommendation
            recommendation = ReorderRecommendation(
                status=ActionStatus.PENDING_APPROVAL,
                product_id=product_id or 0,
                product_name=product_name or "Unknown",
                current_stock=0,
                min_stock_threshold=0,
                suggested_quantity=0,
                reasoning=result.get("output", ""),
                awaiting_approval=True
            )
            
            return recommendation
            
        except Exception as e:
            return ReorderRecommendation(
                status=ActionStatus.FAILED,
                product_id=product_id or 0,
                product_name=product_name or "Unknown",
                current_stock=0,
                min_stock_threshold=0,
                suggested_quantity=0,
                reasoning=f"Error analyzing stock: {str(e)}",
                awaiting_approval=False
            )
    
    async def approve_order(self, draft_id: int, approved: bool, modified_quantity: Optional[int] = None) -> Dict:
        """
        Process human approval or rejection of a reorder draft.
        """
        if not approved:
            return {
                "status": "rejected",
                "message": "Reorder cancelled by user."
            }
        
        return {
            "status": "submitted",
            "message": f"Order submitted for approval by procurement team.",
            "quantity": modified_quantity or "as suggested"
        }
