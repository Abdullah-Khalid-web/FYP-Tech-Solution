"""
Agent #1: Conversational Retail Assistant
Purpose: Natural language interaction hub for retail queries.
Handles: Sales queries, inventory checks, best sellers, general retail questions.
"""

from typing import List, Dict, Any, Optional
from .base_agent import BaseAgent
from schemas import IntentType, AgentType
from tools import RETAIL_ASSISTANT_TOOLS


RETAIL_ASSISTANT_PROMPT = """You are a helpful retail assistant for a shop management system.
Your role is to answer questions about sales, inventory, and general retail operations.

CAPABILITIES:
- Get daily, weekly, or monthly sales totals
- Find top selling products
- Check inventory/stock levels for any product
- Identify low stock items

RULES:
1. Always provide specific numbers when available
2. Include context in your responses (e.g., "compared to yesterday", "below threshold")
3. Be conversational but concise
4. If you don't have data, say so clearly
5. Format currency values appropriately

RESPONSE FORMAT:
- Start with the direct answer to the query
- Add relevant context or insights
- Suggest follow-up actions if helpful

Shop ID: {shop_id}
"""


class RetailAssistantAgent(BaseAgent):
    """
    Conversational Retail Assistant Agent.
    Handles general retail queries about sales, inventory, and products.
    """
    
    def __init__(self, shop_id: int = None):
        super().__init__(
            agent_type=AgentType.RETAIL_ASSISTANT,
            tools=RETAIL_ASSISTANT_TOOLS,
            system_prompt=RETAIL_ASSISTANT_PROMPT,
            shop_id=shop_id
        )
    
    async def reason(self, perceived_input: Dict) -> tuple:
        """
        Determine the type of retail query and required data.
        """
        normalized = perceived_input.get("normalized_input", "")
        entities = perceived_input.get("entities", {})
        
        # Classify intent based on keywords
        if any(kw in normalized for kw in ["sale", "revenue", "sold", "total"]):
            intent = IntentType.SALES_QUERY
            data_needs = ["sales_data"]
            if "top" in normalized or "best" in normalized:
                data_needs.append("top_sellers")
        elif any(kw in normalized for kw in ["stock", "inventory", "left", "available", "quantity"]):
            intent = IntentType.INVENTORY_QUERY
            data_needs = ["inventory_data"]
            if entities.get("product_name"):
                data_needs.append("specific_product")
        else:
            intent = IntentType.UNKNOWN
            data_needs = []
        
        return intent, data_needs
    
    async def plan(self, intent: IntentType, data_needs: List[str]) -> Dict:
        """
        Plan which tools to call based on intent.
        """
        plan = {
            "intent": intent,
            "tools_to_use": [],
            "fallback": "general_search"
        }
        
        if intent == IntentType.SALES_QUERY:
            if "top_sellers" in data_needs:
                plan["tools_to_use"].append("get_top_selling_products")
            else:
                plan["tools_to_use"].append("get_daily_sales")
        
        elif intent == IntentType.INVENTORY_QUERY:
            if "specific_product" in data_needs:
                plan["tools_to_use"].append("search_product")
            else:
                plan["tools_to_use"].append("get_low_stock_items")
        
        return plan
