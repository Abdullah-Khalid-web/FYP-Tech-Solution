"""
Agent #2: Voice-Enabled Billing Agent
Purpose: Hands-free billing via voice commands.
Features: Speech-to-text, item extraction, confirmation flow.

CRITICAL RULE: Never finalize bill without explicit user confirmation.
"""

from typing import List, Dict, Any, Optional
from .base_agent import BaseAgent
from schemas import IntentType, AgentType, ActionStatus, BillingResponse
from tools import BILLING_AGENT_TOOLS


BILLING_AGENT_PROMPT = """You are a voice-enabled billing assistant for a retail shop.
Your job is to process voice commands patiently for adding items to bills.

CAPABILITIES:
- Understand voice commands for adding items
- Extract product names and quantities
- Look up product prices
- Add items to the current bill

CRITICAL RULES:
1. ALWAYS repeat what you understood before taking action
2. NEVER finalize a bill without explicit confirmation
3. If quantity is not specified, assume 1
4. If you're unsure about the product, ask for clarification
5. Confirm each item addition before proceeding

RESPONSE FORMAT:
1. Echo back: "I understood: Add [quantity]x [product] @ [price] each"
2. Ask: "Should I add this to the bill?"
3. Wait for confirmation before executing

COMMON VOICE PATTERNS:
- "Add two milk packets" → product: milk, quantity: 2
- "Bill one sugar" → product: sugar, quantity: 1
- "Add 3 eggs" → product: eggs, quantity: 3

Shop ID: {shop_id}
"""


class BillingAgent(BaseAgent):
    """
    Voice-Enabled Billing Agent.
    Processes voice commands for billing with mandatory confirmation.
    """
    
    def __init__(self, shop_id: int = None):
        super().__init__(
            agent_type=AgentType.BILLING_AGENT,
            tools=BILLING_AGENT_TOOLS,
            system_prompt=BILLING_AGENT_PROMPT,
            shop_id=shop_id
        )
        self.pending_action: Optional[Dict] = None
    
    async def reason(self, perceived_input: Dict) -> tuple:
        """
        Parse billing command to extract item and quantity.
        """
        entities = perceived_input.get("entities", {})
        normalized = perceived_input.get("normalized_input", "")
        
        # Check for billing keywords
        is_billing = any(kw in normalized for kw in ["add", "bill", "include", "put"])
        
        if is_billing:
            intent = IntentType.BILLING_ACTION
            data_needs = ["product_lookup"]
            
            # Store extracted entities for confirmation
            self.pending_action = {
                "product_name": entities.get("product_name"),
                "quantity": entities.get("quantity", 1),
                "awaiting_confirmation": True
            }
        else:
            intent = IntentType.UNKNOWN
            data_needs = []
        
        return intent, data_needs
    
    async def plan(self, intent: IntentType, data_needs: List[str]) -> Dict:
        """
        Plan billing action with confirmation step.
        """
        return {
            "intent": intent,
            "tools_to_use": ["search_product", "add_item_to_bill"],
            "requires_confirmation": True,
            "confirmation_step": "echo_and_confirm"
        }
    
    async def process_with_confirmation(self, user_input: str, confirmed: bool = False) -> BillingResponse:
        """
        Process billing with explicit confirmation flow.
        """
        if self.pending_action and confirmed:
            # User confirmed, execute the action
            return await self._execute_pending_action()
        
        # Start new billing flow
        perceived = await self.perceive(user_input, None)
        intent, _ = await self.reason(perceived)
        
        if intent != IntentType.BILLING_ACTION:
            return BillingResponse(
                status=ActionStatus.NEEDS_CLARIFICATION,
                message="I didn't understand that as a billing command. Please say something like 'Add 2 milk packets'.",
                requires_confirmation=False
            )
        
        # Look up product
        product_name = self.pending_action.get("product_name") if self.pending_action else "unknown"
        quantity = self.pending_action.get("quantity", 1) if self.pending_action else 1
        
        # Generate confirmation prompt
        return BillingResponse(
            status=ActionStatus.PENDING_APPROVAL,
            message=f"I understood: Add {quantity}x {product_name}",
            confirmation_prompt=f"Should I add {quantity}x {product_name} to the bill? Please confirm.",
            requires_confirmation=True
        )
    
    async def _execute_pending_action(self) -> BillingResponse:
        """Execute the confirmed billing action."""
        if not self.pending_action:
            return BillingResponse(
                status=ActionStatus.FAILED,
                message="No pending action to execute.",
                requires_confirmation=False
            )
        
        try:
            # Use LLM to process the billing action
            action_input = f"Add {self.pending_action['quantity']} {self.pending_action['product_name']} to the bill"
            result = await self.act({}, {"original_input": action_input})
            
            # Clear pending action
            self.pending_action = None
            
            return BillingResponse(
                status=ActionStatus.SUCCESS,
                message=result.get("output", "Item added to bill."),
                requires_confirmation=False
            )
        except Exception as e:
            return BillingResponse(
                status=ActionStatus.FAILED,
                message=f"Failed to add item: {str(e)}",
                requires_confirmation=False
            )
    
    def cancel_pending(self):
        """Cancel any pending billing action."""
        self.pending_action = None
