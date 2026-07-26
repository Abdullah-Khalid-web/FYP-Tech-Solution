"""
Backend API Client - Handles all interactions with the backend REST APIs.
Includes MOCK MODE for testing without a backend server.
"""

from typing import Dict, Any, List, Optional
import httpx
from datetime import datetime
import asyncio
from config import settings, API_ENDPOINTS
import contextvars

# Context variable to store the shop ID for the current request context
current_shop_id = contextvars.ContextVar('shop_id', default=settings.DEFAULT_SHOP_ID)

class BackendAPIClient:
    """Client for interactions with the Backend REST API."""
    
    def __init__(self, base_url: Optional[str] = None):
        self.base_url = base_url or settings.BACKEND_API_BASE_URL
        self.mock_mode = settings.MOCK_MODE
        self._client: Optional[httpx.AsyncClient] = None
        
        # Mock Data Store
        if self.mock_mode:
            print("API Client running in MOCK MODE")
    
    def _get_headers(self) -> Dict[str, str]:
        """Get headers dynamically for the current request context."""
        shop_id = current_shop_id.get()
        return {
            "Content-Type": "application/json",
            "X-Shop-ID": str(shop_id),
            "X-AI-Service-Key": settings.AI_SERVICE_SECRET if hasattr(settings, 'AI_SERVICE_SECRET') else "",
        }
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create a persistent HTTP client for connection pooling."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=settings.BACKEND_API_TIMEOUT,
            )
        return self._client
    
    async def _get(self, endpoint: str, params: Dict = None) -> Dict:
        """Helper for GET requests with mock support."""
        if self.mock_mode:
            return self._get_mock_response(endpoint, params)
        
        try:
            client = await self._get_client()
            headers = self._get_headers()
            response = await client.get(endpoint, params=params, headers=headers)
            response.raise_for_status()
            return response.json()
        except httpx.ConnectError:
            print(f"Backend unreachable at {self.base_url}{endpoint}")
            return {"error": "Backend service unreachable", "endpoint": endpoint}
        except httpx.HTTPStatusError as e:
            print(f"Backend returned {e.response.status_code} for {endpoint}")
            return {"error": f"Backend error: {e.response.status_code}", "endpoint": endpoint}
        except Exception as e:
            print(f"Unexpected error calling {endpoint}: {e}")
            return {"error": str(e), "endpoint": endpoint}

    async def _post(self, endpoint: str, data: Dict = None) -> Dict:
        """Helper for POST requests with mock support."""
        if self.mock_mode:
            return self._post_mock_response(endpoint, data)

        try:
            client = await self._get_client()
            headers = self._get_headers()
            response = await client.post(endpoint, json=data, headers=headers)
            response.raise_for_status()
            return response.json()
        except httpx.ConnectError:
            print(f"Backend unreachable at {self.base_url}{endpoint}")
            return {"error": "Backend service unreachable", "endpoint": endpoint}
        except httpx.HTTPStatusError as e:
            print(f"Backend returned {e.response.status_code} for {endpoint}")
            return {"error": f"Backend error: {e.response.status_code}", "endpoint": endpoint}
        except Exception as e:
            print(f"Unexpected error calling {endpoint}: {e}")
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
        endpoint = API_ENDPOINTS.get("analytics", {}).get("sales_trend", "/analytics/sales-trend")
        return await self._get(endpoint, params={"period": period})

    async def get_top_selling_products(self, limit: int = 5) -> Dict:
        endpoint = API_ENDPOINTS.get("sales", {}).get("top_sellers", "/sales/top-sellers")
        return await self._get(endpoint, params={"limit": limit})

    # =========================================================================
    # Billing Endpoints
    # =========================================================================

    async def add_item_to_bill(self, product_name: str, quantity: int) -> Dict:
        product_data = await self.search_product(product_name)
        if "error" in product_data or not product_data.get("products"):
            return {"error": f"Product '{product_name}' not found."}
        
        product = product_data["products"][0]
        price = float(product.get("selling_price", 0))
        return {
            "status": "pending_confirmation",
            "product_id": product.get("id"),
            "product_name": product.get("name"),
            "quantity": quantity,
            "unit_price": price,
            "subtotal": price * quantity
        }

    async def search_product(self, query: str) -> Dict:
        endpoint = API_ENDPOINTS.get("inventory", {}).get("product_by_name", "/products/search")
        return await self._get(endpoint, params={"q": query})

    async def get_product_stock(self, product_id: int) -> Dict:
        endpoint = API_ENDPOINTS.get("inventory", {}).get("stock_level", "/products/{product_id}/stock")
        endpoint = endpoint.replace("{product_id}", str(product_id))
        return await self._get(endpoint)

    # =========================================================================
    # Inventory Endpoints
    # =========================================================================

    async def get_low_stock_items(self) -> Dict:
        endpoint = API_ENDPOINTS.get("inventory", {}).get("low_stock", "/products/low-stock")
        return await self._get(endpoint)

    async def create_reorder_draft(self, product_id: int, quantity: int) -> Dict:
        return {
            "status": "draft_created",
            "product_id": product_id,
            "quantity": quantity
        }

    # =========================================================================
    # Staff Endpoints
    # =========================================================================

    async def get_staff_performance_metrics(self, user_id: int = None) -> Dict:
        endpoint = API_ENDPOINTS.get("staff", {}).get("performance_metrics", "/users/performance")
        params = {"user_id": user_id} if user_id else {}
        return await self._get(endpoint, params=params)

    async def get_cashier_activity_log(self, user_id: int) -> Dict:
        endpoint = API_ENDPOINTS.get("staff", {}).get("cashier_logs", "/users/{user_id}/activity-logs")
        endpoint = endpoint.replace("{user_id}", str(user_id))
        return await self._get(endpoint)

    # =========================================================================
    # Reports Endpoints
    # =========================================================================

    async def get_daily_report(self) -> Dict:
        endpoint = API_ENDPOINTS.get("reports", {}).get("daily_summary", "/reports/daily")
        return await self._get(endpoint)

    async def get_weekly_report(self) -> Dict:
        endpoint = API_ENDPOINTS.get("reports", {}).get("weekly_summary", "/reports/weekly")
        return await self._get(endpoint)

    # =========================================================================
    # Analytics Endpoints
    # =========================================================================

    async def get_discount_usage_patterns(self) -> Dict:
        endpoint = API_ENDPOINTS.get("analytics", {}).get("discount_patterns", "/analytics/discount-patterns")
        return await self._get(endpoint)

    async def get_detected_anomalies(self) -> Dict:
        endpoint = API_ENDPOINTS.get("analytics", {}).get("anomalies", "/analytics/anomalies")
        return await self._get(endpoint)

# Global API Client Instance
api_client = BackendAPIClient()
