import asyncio
import contextvars
from api_client import current_shop_id, api_client

async def test():
    current_shop_id.set('24')
    print(await api_client.search_product('suger'))

asyncio.run(test())
