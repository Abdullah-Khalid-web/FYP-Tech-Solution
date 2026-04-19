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
        
        # Fast keyword matching
        for intent_name, keywords in INTENT_CATEGORIES.items():
            if any(kw in query_lower for kw in keywords):
                return IntentType(intent_name)
        
        # Fall back to LLM classification
        classification_prompt = f"""
        Classify this retail query into one category:
        sales_query, inventory_query, billing_action, reorder_action, 
        staff_query, report_query, forecast_query, anomaly_query, expense_query
        
        Query: "{query}"
        Respond with ONLY the category name.
        """
        
        try:
            result = await self.llm.ainvoke([HumanMessage(content=classification_prompt)])
            intent_str = result.content.strip().lower()
            return IntentType(intent_str)
        except:
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


# Global router instance
router = AgentRouter()
