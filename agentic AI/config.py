"""
Configuration settings for the Agentic AI Service.
All backend API endpoints and LLM settings are configured here.
"""

from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # LLM Configuration (Groq)
    GROQ_API_KEY: str = "your_groq_api_key_here"
    LLM_MODEL: str = "llama-3.3-70b-versatile"
    LLM_TEMPERATURE: float = 0.1
    
    # Backend API Configuration (provided by backend team)
    BACKEND_API_BASE_URL: str = "http://localhost:3000/api"
    BACKEND_API_TIMEOUT: int = 30
    
    # Shop Configuration (multi-tenant support)
    DEFAULT_SHOP_ID: int = 24
    
    # Testing Configuration
    MOCK_MODE: bool = False  # Set to True for testing without backend
    
    # Agent Settings
    MAX_RETRIES: int = 3
    VERBOSE_LOGGING: bool = True
    
    # Security
    AI_SERVICE_SECRET: str = ""  # Must match backend's AI_SERVICE_SECRET
    ALLOWED_ORIGINS: str = "http://localhost:3000"  # Comma-separated origins
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()


# Backend API Endpoints (mapped from database schema)
# These endpoints should be implemented by the backend team

API_ENDPOINTS = {
    # Sales & Billing APIs
    "sales": {
        "daily_total": "/sales/daily",
        "weekly_total": "/sales/weekly",
        "monthly_total": "/sales/monthly",
        "by_date_range": "/sales/range",
        "top_sellers": "/sales/top-sellers",
        "by_category": "/sales/by-category",
        "transactions": "/sales/transactions",
    },
    
    # Billing APIs
    "billing": {
        "current_bill": "/billing/current",
        "add_item": "/billing/add-item",
        "remove_item": "/billing/remove-item",
        "apply_discount": "/billing/discount",
        "finalize": "/billing/finalize",
        "void": "/billing/void",
        "get_bill": "/billing/{bill_id}",
    },
    
    # Inventory/Products APIs
    "inventory": {
        "all_products": "/products",
        "product_by_id": "/products/{product_id}",
        "product_by_name": "/products/search",
        "low_stock": "/products/low-stock",
        "stock_level": "/products/{product_id}/stock",
        "update_stock": "/products/{product_id}/stock",
    },
    
    # Raw Materials APIs
    "raw_materials": {
        "all": "/raw-materials",
        "by_id": "/raw-materials/{id}",
        "low_stock": "/raw-materials/low-stock",
        "alerts": "/raw-materials/alerts",
        "movements": "/raw-materials/{id}/movements",
    },
    
    # Staff APIs
    "staff": {
        "all_users": "/users",
        "user_by_id": "/users/{user_id}",
        "cashier_logs": "/users/{user_id}/activity-logs",
        "performance_metrics": "/users/performance",
        "salaries": "/users/{user_id}/salaries",
    },
    
    # Reports APIs
    "reports": {
        "daily_summary": "/reports/daily",
        "weekly_summary": "/reports/weekly",
        "monthly_summary": "/reports/monthly",
        "profit_loss": "/reports/profit-loss",
        "inventory_report": "/reports/inventory",
        "staff_performance": "/reports/staff-performance",
        "expenses": "/reports/expenses",
    },
    
    # Analytics APIs
    "analytics": {
        "sales_trend": "/analytics/sales-trend",
        "moving_average": "/analytics/moving-average",
        "category_analysis": "/analytics/categories",
        "discount_patterns": "/analytics/discount-patterns",
        "anomalies": "/analytics/anomalies",
    },
    
    # Orders/Restock APIs
    "orders": {
        "create_draft": "/orders/draft",
        "pending_orders": "/orders/pending",
        "approve_order": "/orders/{order_id}/approve",
        "reject_order": "/orders/{order_id}/reject",
    },
    
    # Suppliers APIs
    "suppliers": {
        "all": "/suppliers",
        "by_id": "/suppliers/{supplier_id}",
        "products": "/suppliers/{supplier_id}/products",
    },
}


# Intent Categories for Classification
INTENT_CATEGORIES = {
    "sales_query": [
        "total sale", "today sale", "revenue", "sales report", 
        "how much sold", "daily sales", "weekly sales", "monthly sales",
        "best seller", "top selling", "most sold"
    ],
    "inventory_query": [
        "stock", "inventory", "left in stock", "available", 
        "how much", "quantity", "remaining", "low stock"
    ],
    "billing_action": [
        "add to bill", "bill item", "checkout", "add", 
        "remove from bill", "apply discount", "finalize bill"
    ],
    "reorder_action": [
        "reorder", "order more", "stock up", "purchase", 
        "buy more", "replenish", "should i order"
    ],
    "staff_query": [
        "cashier", "employee", "staff", "performance", 
        "who sold", "worker", "team member"
    ],
    "report_query": [
        "report", "summary", "explain report", "analysis",
        "breakdown", "overview", "statistics"
    ],
    "forecast_query": [
        "predict", "forecast", "trend", "next week",
        "expect", "projection", "future", "estimate"
    ],
    "anomaly_query": [
        "unusual", "suspicious", "fraud", "abnormal",
        "why", "strange", "investigate", "check"
    ],
    "expense_query": [
        "expense", "spending", "cost", "expenditure"
    ],
}
