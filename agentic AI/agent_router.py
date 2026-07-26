"""
Agent Router - Intelligent routing of user queries to appropriate agents.
Updated for LangChain 1.x compatibility.
"""

from typing import Dict, Optional
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage

from config import settings, INTENT_CATEGORIES
from schemas import IntentType, AgentType, UserQuery, AgentResponse
from agents import (
    RetailAssistantAgent,
    BillingAgent,
    StockOrderingAgent,
    ForecastAgent,
    AnomalyAgent,
    StaffAgent,
    ReportAgent,
)


class AgentRouter:
    """Routes user queries to the appropriate specialized agent."""
    
    def __init__(self, shop_id: int = None):
        self.shop_id = shop_id or settings.DEFAULT_SHOP_ID
        
        # Initialize LLM for intent classification
        self.llm = ChatGroq(
            model_name=settings.LLM_MODEL,
            temperature=0,
            api_key=settings.GROQ_API_KEY
        )
        
        # Initialize all agents
        self.agents = {
            AgentType.RETAIL_ASSISTANT: RetailAssistantAgent(shop_id=self.shop_id),
            AgentType.BILLING_AGENT: BillingAgent(shop_id=self.shop_id),
            AgentType.STOCK_AGENT: StockOrderingAgent(shop_id=self.shop_id),
            AgentType.FORECAST_AGENT: ForecastAgent(shop_id=self.shop_id),
            AgentType.ANOMALY_AGENT: AnomalyAgent(shop_id=self.shop_id),
            AgentType.STAFF_AGENT: StaffAgent(shop_id=self.shop_id),
            AgentType.REPORT_AGENT: ReportAgent(shop_id=self.shop_id),
        }
        
        # Intent to Agent mapping
        self.intent_to_agent = {
            IntentType.SALES_QUERY: AgentType.RETAIL_ASSISTANT,
            IntentType.INVENTORY_QUERY: AgentType.RETAIL_ASSISTANT,
            IntentType.BILLING_ACTION: AgentType.BILLING_AGENT,
            IntentType.REORDER_ACTION: AgentType.STOCK_AGENT,
            IntentType.FORECAST_QUERY: AgentType.FORECAST_AGENT,
            IntentType.ANOMALY_QUERY: AgentType.ANOMALY_AGENT,
            IntentType.STAFF_QUERY: AgentType.STAFF_AGENT,
            IntentType.REPORT_QUERY: AgentType.REPORT_AGENT,
            IntentType.EXPENSE_QUERY: AgentType.REPORT_AGENT,
        }
    
    async def classify_intent(self, query: str) -> IntentType:
        """Classify the intent of a user query."""
        query_lower = query.lower()
        
        # Fast keyword matching (score-based)
        scores = {}
        for intent_name, keywords in INTENT_CATEGORIES.items():
            scores[intent_name] = sum(1 for kw in keywords if kw in query_lower)
            
        max_score = max(scores.values()) if scores else 0
        if max_score > 0:
            top_intents = [name for name, score in scores.items() if score == max_score]
            if len(top_intents) == 1:
                return IntentType(top_intents[0])
        
        # Fall back to LLM classification
        classification_prompt = f"""
        Classify this retail query into the most appropriate category from this list:
        - sales_query: general sales, top items
        - inventory_query: stock levels
        - billing_action: checkout
        - reorder_action: restocking
        - staff_query: MUST use this for ANY questions about employee or cashier performance, staff revenue, or staff breakdown
        - report_query: daily/weekly business reports (NOT staff specific)
        - forecast_query: predictions
        - anomaly_query: anomalies
        - expense_query: expenses
        
        Query: "{query}"
        
        Respond ONLY with the category name (e.g. staff_query).
        """
        
        try:
            result = await self.llm.ainvoke([HumanMessage(content=classification_prompt)])
            intent_str = result.content.strip().lower()
            return IntentType(intent_str)
        except Exception:
            return IntentType.UNKNOWN
    
    async def route(self, user_query: UserQuery) -> AgentResponse:
        """Route a user query to the appropriate agent."""
        intent = await self.classify_intent(user_query.query)
        agent_type = self.intent_to_agent.get(intent, AgentType.RETAIL_ASSISTANT)
        agent = self.agents.get(agent_type, self.agents[AgentType.RETAIL_ASSISTANT])
        
        context = {
            "shop_id": user_query.shop_id,
            "user_id": user_query.user_id,
            "session_id": user_query.session_id,
            "is_voice": user_query.is_voice,
        }
        
        return await agent.process(user_query.query, context)
    
    def get_agent(self, agent_type: AgentType):
        """Get a specific agent instance."""
        return self.agents.get(agent_type)
    
    def clear_all_history(self):
        """Clear conversation history for all agents."""
        for agent in self.agents.values():
            agent.clear_history()


