import asyncio
from agent_router import AgentRouter

async def test():
    router = AgentRouter()
    query = 'Give me a breakdown of how much revenue each staff member has generated'
    intent = await router.classify_intent(query)
    print('Classification:', intent)

asyncio.run(test())
