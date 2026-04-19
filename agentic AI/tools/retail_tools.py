"""
LangChain Tools - Tool definitions for backend API calls.
These tools are used by agents to interact with the backend.
"""

from langchain.tools import tool
from typing import Optional
from api_client import api_client


# =============================================================================
# Sales Tools
# =============================================================================

@tool
async def get_daily_sales(date: Optional[str] = None) -> dict:
    """
    Get total sales for a specific day.
    
    Args:
        date: Date in YYYY-MM-DD format. Defaults to today if not provided.
    
    Returns:
        Dict containing total sales amount, transaction count, and breakdown.
    """
    return await api_client.get_daily_sales(date)


@tool
async def get_weekly_sales() -> dict:
    """
    Get sales summary for the current week.
    
    Returns:
        Dict containing weekly sales total, daily breakdown, and comparison to last week.
    """
    return await api_client.get_weekly_sales()


@tool
async def get_top_selling_products(limit: int = 10) -> dict:
    """
    Get the top selling products.
    
    Args:
        limit: Number of top products to return (default: 10)
    
    Returns:
        List of top selling products with quantity sold and revenue.
    """
    return await api_client.get_top_selling_products(limit)


@tool
async def get_transactions(date: Optional[str] = None) -> dict:
    """
    Get transaction details for a specific day.
    
    Args:
        date: Date in YYYY-MM-DD format. Defaults to today.
    
    Returns:
        List of transactions with details.
    """
    from config import API_ENDPOINTS
    endpoint = API_ENDPOINTS.get("sales", {}).get("transactions", "/sales/transactions")
    params = {"date": date} if date else {}
    return await api_client._get(endpoint, params=params)


# =============================================================================
# Inventory Tools
# =============================================================================

@tool
async def search_product(product_name: str) -> dict:
    """
    Search for a product by name.
    
    Args:
        product_name: Name or partial name of the product to search.
    
    Returns:
        Product details including stock level, price, and category.
    """
    return await api_client.search_product(product_name)


@tool
async def get_product_stock(product_id: int) -> dict:
    """
    Get current stock level for a specific product.
    
    Args:
        product_id: ID of the product.
    
    Returns:
        Stock level, minimum threshold, and reorder status.
    """
    return await api_client.get_product_stock(product_id)


@tool
async def get_low_stock_items() -> dict:
    """
    Get all products below minimum stock threshold.
    
    Returns:
        List of low stock products with current quantity and threshold.
    """
    return await api_client.get_low_stock_items()


@tool
async def get_all_products(category: Optional[str] = None) -> dict:
    """
    Get all products, optionally filtered by category.
    
    Args:
        category: Category to filter by (optional)
    
    Returns:
        List of products with details.
    """
    from config import API_ENDPOINTS
    endpoint = API_ENDPOINTS.get("inventory", {}).get("all_products", "/products")
    params = {"category": category} if category else {}
    return await api_client._get(endpoint, params=params)


# =============================================================================
# Billing Tools
# =============================================================================

@tool
async def add_item_to_bill(product_name: str, quantity: int = 1) -> dict:
    """
    Add an item to the current bill.
    
    IMPORTANT: This action requires user confirmation before execution.
    
    Args:
        product_name: Name of the product to add.
        quantity: Quantity to add (default: 1)
    
    Returns:
        Confirmation of item added with current bill total.
    """
    return await api_client.add_item_to_bill(product_name, quantity)


@tool
async def get_current_bill() -> dict:
    """
    Get the current active bill details.
    
    Returns:
        Current bill items, subtotal, discounts, and total.
    """
    from config import API_ENDPOINTS
    endpoint = API_ENDPOINTS.get("billing", {}).get("current_bill", "/billing/current")
    return await api_client._get(endpoint)


# =============================================================================
# Staff Tools
# =============================================================================

@tool
async def get_staff_list(role: Optional[str] = None) -> dict:
    """
    Get list of staff members.
    
    Args:
        role: Filter by role (cashier, manager, owner, other)
    
    Returns:
        List of staff with basic info.
    """
    from config import API_ENDPOINTS
    endpoint = API_ENDPOINTS.get("staff", {}).get("all_users", "/users")
    params = {"role": role} if role else {}
    return await api_client._get(endpoint, params=params)


@tool
async def get_cashier_activity(user_id: int, date: Optional[str] = None) -> dict:
    """
    Get activity logs for a specific cashier.
    
    Args:
        user_id: ID of the cashier.
        date: Date to filter logs (optional)
    
    Returns:
        Activity logs including transactions processed, discounts applied.
    """
    return await api_client.get_cashier_activity_log(user_id)


@tool
async def get_staff_performance_metrics() -> dict:
    """
    Get performance metrics for all staff.
    
    Returns:
        Performance data including transactions, sales volume, discount usage.
    """
    return await api_client.get_staff_performance_metrics()


# =============================================================================
# Report Tools
# =============================================================================

@tool
async def get_daily_report(date: Optional[str] = None) -> dict:
    """
    Get daily business report.
    
    Args:
        date: Date for the report (default: today)
    
    Returns:
        Daily summary with sales, expenses, and profit.
    """
    return await api_client.get_daily_report()


@tool
async def get_weekly_report() -> dict:
    """
    Get weekly business report.
    
    Returns:
        Weekly summary with trends, top products, and comparisons.
    """
    return await api_client.get_weekly_report()


@tool
async def get_expense_report(start_date: Optional[str] = None, end_date: Optional[str] = None) -> dict:
    """
    Get expense report for a period.
    
    Args:
        start_date: Start date (optional)
        end_date: End date (optional)
    
    Returns:
        Expense breakdown by category.
    """
    from config import API_ENDPOINTS
    endpoint = API_ENDPOINTS.get("reports", {}).get("expenses", "/reports/expenses")
    params = {}
    if start_date: params["start_date"] = start_date
    if end_date: params["end_date"] = end_date
    return await api_client._get(endpoint, params=params)


# =============================================================================
# Analytics Tools
# =============================================================================

@tool
async def get_sales_trend(period: str = "weekly") -> dict:
    """
    Get sales trend analysis.
    
    Args:
        period: Time period - daily, weekly, or monthly
    
    Returns:
        Trend data with direction (up/down/stable) and percentage change.
    """
    return await api_client.get_sales_trend(period)


@tool
async def get_discount_usage_patterns() -> dict:
    """
    Get discount usage patterns for anomaly detection.
    
    Returns:
        Discount patterns by cashier, time, and amount.
    """
    return await api_client.get_discount_usage_patterns()


@tool
async def get_detected_anomalies() -> dict:
    """
    Get list of detected anomalies in transactions.
    
    Returns:
        List of suspicious activities with severity and details.
    """
    return await api_client.get_detected_anomalies()


# =============================================================================
# Order/Restock Tools
# =============================================================================

@tool
async def create_reorder_draft(product_id: int, quantity: int, supplier_id: Optional[int] = None) -> dict:
    """
    Create a draft reorder for a product.
    
    IMPORTANT: This creates a DRAFT only. Human approval is required to submit.
    
    Args:
        product_id: ID of the product to reorder.
        quantity: Suggested quantity to order.
        supplier_id: Preferred supplier ID (optional)
    
    Returns:
        Draft order details with estimated cost.
    """
    return await api_client.create_reorder_draft(product_id, quantity)


# =============================================================================
# Tool Collections by Agent
# =============================================================================

RETAIL_ASSISTANT_TOOLS = [
    get_daily_sales,
    get_weekly_sales,
    get_top_selling_products,
    search_product,
    get_product_stock,
    get_low_stock_items,
]

BILLING_AGENT_TOOLS = [
    search_product,
    add_item_to_bill,
    get_current_bill,
]

STOCK_AGENT_TOOLS = [
    get_low_stock_items,
    get_product_stock,
    get_sales_trend,
    create_reorder_draft,
]

FORECAST_AGENT_TOOLS = [
    get_sales_trend,
    get_weekly_sales,
    get_top_selling_products,
]

ANOMALY_AGENT_TOOLS = [
    get_discount_usage_patterns,
    get_detected_anomalies,
    get_transactions,
    get_cashier_activity,
]

STAFF_AGENT_TOOLS = [
    get_staff_list,
    get_cashier_activity,
    get_staff_performance_metrics,
    get_discount_usage_patterns,
]

REPORT_AGENT_TOOLS = [
    get_daily_report,
    get_weekly_report,
    get_expense_report,
    get_sales_trend,
    get_top_selling_products,
]
