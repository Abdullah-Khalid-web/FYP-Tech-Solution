"""
Backend API Client - Handles all interactions with the backend REST APIs.
Includes MOCK MODE for testing without a backend server.
"""

from typing import Dict, Any, List, Optional
import httpx
from datetime import datetime
import asyncio
from config import settings, API_ENDPOINTS

class BackendAPIClient:
    """Client for interactions with the Backend REST API."""
    
    def __init__(self, base_url: Optional[str] = None, shop_id: Optional[int] = None):
        self.base_url = base_url or settings.BACKEND_API_BASE_URL
        self.shop_id = shop_id or settings.DEFAULT_SHOP_ID
        self.headers = {
            "Content-Type": "application/json",
            "X-Shop-ID": str(self.shop_id),
            "X-AI-Service-Key": settings.AI_SERVICE_SECRET if hasattr(settings, 'AI_SERVICE_SECRET') else "",
        }
        self.mock_mode = settings.MOCK_MODE
        self._client: Optional[httpx.AsyncClient] = None
        
        # Mock Data Store
        if self.mock_mode:
            print("⚠️ API Client running in MOCK MODE")
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create a persistent HTTP client for connection pooling."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                headers=self.headers,
                timeout=settings.BACKEND_API_TIMEOUT,
            )
        return self._client
    
    async def _get(self, endpoint: str, params: Dict = None) -> Dict:
        """Helper for GET requests with mock support."""
        if self.mock_mode:
            return self._get_mock_response(endpoint, params)
        
        try:
            client = await self._get_client()
            response = await client.get(endpoint, params=params)
            response.raise_for_status()
            return response.json()
        except httpx.ConnectError:
            print(f"⚠️ Backend unreachable at {self.base_url}{endpoint}")
            return {"error": "Backend service unreachable", "endpoint": endpoint}
        except httpx.HTTPStatusError as e:
            print(f"⚠️ Backend returned {e.response.status_code} for {endpoint}")
            return {"error": f"Backend error: {e.response.status_code}", "endpoint": endpoint}
        except Exception as e:
            print(f"⚠️ Unexpected error calling {endpoint}: {e}")
            return {"error": str(e), "endpoint": endpoint}

    async def _post(self, endpoint: str, data: Dict = None) -> Dict:
        """Helper for POST requests with mock support."""
        if self.mock_mode:
            return self._post_mock_response(endpoint, data)

        try:
            client = await self._get_client()
            response = await client.post(endpoint, json=data)
            response.raise_for_status()
            return response.json()
        except httpx.ConnectError:
            print(f"⚠️ Backend unreachable at {self.base_url}{endpoint}")
            return {"error": "Backend service unreachable", "endpoint": endpoint}
        except httpx.HTTPStatusError as e:
            print(f"⚠️ Backend returned {e.response.status_code} for {endpoint}")
            return {"error": f"Backend error: {e.response.status_code}", "endpoint": endpoint}
        except Exception as e:
            print(f"⚠️ Unexpected error calling {endpoint}: {e}")
            return {"error": str(e), "endpoint": endpoint}
            
    # =========================================================================
    # Mock Logic
    # =========================================================================
    
    def _get_mock_response(self, endpoint: str, params: Dict = None) -> Dict:
        """Return dummy data for testing."""
        # Sales APIs
        if "daily" in endpoint:
            return {"total_sales": 15430.50, "transaction_count": 45, "date": str(datetime.now().date())}
        if "weekly" in endpoint:
            return {"total_sales": 87500.00, "period": "current_week"}
        if "top-selling" in endpoint:
            return {"items": [{"name": "Milk", "qty": 120}, {"name": "Bread", "qty": 85}, {"name": "Eggs", "qty": 60}]}
            
        # Inventory APIs
        if "stock" in endpoint and "product" in endpoint:
            # Random stock check
            return {"product": "Sample Item", "current_stock": 15, "min_threshold": 20, "status": "low_stock"}
        if "low-stock" in endpoint:
            return {"items": [{"name": "Sugar", "current": 5, "min": 20}, {"name": "Rice", "current": 10, "min": 50}]}
            
        # Sales Trend
        if "trend" in endpoint:
            return {"trend": "up", "percentage": 12.5, "period": "vs_last_week"}
            
        # Staff
        if "performance" in endpoint:
            return {"user_id": 1, "efficiency": 95, "sales_handled": 5000}
            
        # Reports
        if "report" in endpoint:
            return {
                "summary": "Good performance overall.",
                "total_sales": 15000,
                "top_products": ["Milk", "Bread"],
                "alerts": ["Sugar is low stock"]
            }
        
        return {"message": "Mock response", "endpoint": endpoint}

    def _post_mock_response(self, endpoint: str, data: Dict = None) -> Dict:
        """Return dummy success for POST actions."""
        if "billing" in endpoint:
            return {"status": "success", "bill_id": 101, "item_added": data.get("item", "unknown")}
        if "order" in endpoint:
            return {"status": "success", "order_id": 505, "message": "Draft created"}
            
        return {"status": "success", "message": "Mock action executed"}

    # =========================================================================
    # Sales Endpoints
    # =========================================================================

    async def get_daily_sales(self, date: str = None) -> Dict:
        endpoint = API_ENDPOINTS.get("sales", {}).get("daily_total", "/sales/daily")
        params = {"date": date} if date else {}
        return await self._get(endpoint, params=params)

    async def get_weekly_sales(self) -> Dict:
        endpoint = API_ENDPOINTS.get("sales", {}).get("weekly_total", "/sales/weekly")
        return await self._get(endpoint)
        
    async def get_sales_trend(self, period: str = "weekly") -> Dict:
        endpoint = API_ENDPOINTS.get("analytics", {}).get("trends", "/analytics/trends")
        return await self._get(endpoint, params={"period": period})

    async def get_top_selling_products(self, limit: int = 5) -> Dict:
        endpoint = API_ENDPOINTS.get("sales", {}).get("top_selling", "/sales/top-selling")
        return await self._get(endpoint, params={"limit": limit})

    # =========================================================================
    # Billing Endpoints
    # =========================================================================

    async def add_item_to_bill(self, product_name: str, quantity: int) -> Dict:
        endpoint = API_ENDPOINTS.get("billing", {}).get("add_item", "/billing/add")
        return await self._post(endpoint, data={"product": product_name, "quantity": quantity})

    async def search_product(self, query: str) -> Dict:
        endpoint = API_ENDPOINTS.get("inventory", {}).get("search", "/products/search")
        return await self._get(endpoint, params={"q": query})

    async def get_product_stock(self, product_name: str) -> Dict:
        endpoint = API_ENDPOINTS.get("inventory", {}).get("stock_level", "/products/stock")
        return await self._get(endpoint, params={"name": product_name})

    # =========================================================================
    # Inventory Endpoints
    # =========================================================================

    async def get_low_stock_items(self) -> Dict:
        endpoint = API_ENDPOINTS.get("inventory", {}).get("low_stock", "/products/low-stock")
        return await self._get(endpoint)

    async def create_reorder_draft(self, product_id: int, quantity: int) -> Dict:
        endpoint = API_ENDPOINTS.get("orders", {}).get("create_draft", "/orders/draft")
        return await self._post(endpoint, data={"product_id": product_id, "quantity": quantity})

    # =========================================================================
    # Staff Endpoints
    # =========================================================================

    async def get_staff_performance_metrics(self, user_id: int = None) -> Dict:
        endpoint = API_ENDPOINTS.get("staff", {}).get("performance", "/staff/performance")
        params = {"user_id": user_id} if user_id else {}
        return await self._get(endpoint, params=params)

    async def get_cashier_activity_log(self, user_id: int) -> Dict:
        endpoint = API_ENDPOINTS.get("staff", {}).get("logs", "/staff/logs")
        return await self._get(endpoint, params={"user_id": user_id})

    # =========================================================================
    # Reports Endpoints
    # =========================================================================

    async def get_daily_report(self) -> Dict:
        endpoint = API_ENDPOINTS.get("reports", {}).get("daily", "/reports/daily")
        return await self._get(endpoint)

    async def get_weekly_report(self) -> Dict:
        endpoint = API_ENDPOINTS.get("reports", {}).get("weekly", "/reports/weekly")
        return await self._get(endpoint)

    # =========================================================================
    # Analytics Endpoints
    # =========================================================================

    async def get_discount_usage_patterns(self) -> Dict:
        endpoint = API_ENDPOINTS.get("analytics", {}).get("discounts", "/analytics/discounts")
        return await self._get(endpoint)

    async def get_detected_anomalies(self) -> Dict:
        endpoint = API_ENDPOINTS.get("analytics", {}).get("anomalies", "/analytics/anomalies")
        return await self._get(endpoint)

# Global API Client Instance
api_client = BackendAPIClient()
