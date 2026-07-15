"""
Terminal Test Script
Allows interactive testing of the Agentic AI Service in the terminal.
Supports MOCK MODE for backend data.
"""

import asyncio
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Force MOCK_MODE for this test
os.environ["MOCK_MODE"] = "True"

from agent_router import router
from schemas import UserQuery

async def main():
    print("🚀 Agentic AI Service - Terminal Test Mode")
    print("------------------------------------------")
    
    # Check OpenAI Key
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("⚠️  No OPENAI_API_KEY found in .env")
        print("   Agents will NOT work without an LLM.")
        print("   Please add your key to .env to test full functionality.")
        key = input("   Or enter your key here for this session: ").strip()
        if key:
            os.environ["OPENAI_API_KEY"] = key
            # Re-initialize router with key
            router.__init__() 
        else:
            print("❌ Cannot proceed without OpenAI Key.")
            return

    print("\n✅ System Ready!")
    print("   - Backend: MOCK MODE (No DB required)")
    print("   - Frontend: TERMINAL INTERFACE")
    print("\nType 'exit' to quit.\n")

    session_id = "test-session-001"
    
    while True:
        try:
            user_input = input("\nYou: ").strip()
            if user_input.lower() in ["exit", "quit"]:
                break
            
            if not user_input:
                continue
                
            print("🤖 Agent thinking...", end="\r")
            
            # Create query object
            query = UserQuery(
                query=user_input,
                shop_id=24,
                session_id=session_id
            )
            
            # Route to agent
            response = await router.route(query)
            
            print(f"🤖 {response.response}")
            if response.data:
                print(f"   [Data: {response.data}]")
            if response.requires_confirmation:
                print(f"   [⚠️ Requires Confirmation]")
                
        except Exception as e:
            print(f"\n❌ Error: {str(e)}")

if __name__ == "__main__":
    asyncio.run(main())
