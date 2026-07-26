import asyncio
import sys
import os

sys.path.append(os.path.join(os.getcwd(), 'agentic AI'))

from config import settings
from agents.retail_assistant import RetailAssistantAgent

async def test_agent():
    print(f"Using model: {settings.LLM_MODEL}")
    agent = RetailAssistantAgent()
    
    query = "How much sugar is left in stock right now?"
    print(f"\nQuery: {query}")
    
    response = await agent.process(query)
    
    print("\n--- Final Response ---")
    print(f"Status: {response.status}")
    print(f"Response: {response.response}")
    print(f"Reasoning: {response.reasoning}")

if __name__ == "__main__":
    asyncio.run(test_agent())
