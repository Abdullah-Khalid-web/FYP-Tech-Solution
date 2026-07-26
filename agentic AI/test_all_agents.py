"""
Test all 7 AI agents by sending requests to their endpoints.
"""
import httpx
import asyncio
import json
import time

BASE_URL = "http://localhost:8000"
HEADERS = {
    "Content-Type": "application/json",
    "x-ai-service-key": "managehub-ai-secret-2026"
}

TESTS = []

def log_result(name, status, response_time, response_data, error=None):
    result = {
        "agent": name,
        "status": "PASS" if status else "FAIL",
        "response_time": f"{response_time:.2f}s",
    }
    if error:
        result["error"] = str(error)
    else:
        if isinstance(response_data, dict):
            resp_str = response_data.get("response", response_data.get("message", response_data.get("executive_summary", str(response_data))))
            if isinstance(resp_str, str) and len(resp_str) > 200:
                resp_str = resp_str[:200] + "..."
            result["response_preview"] = resp_str
        else:
            result["response_preview"] = str(response_data)[:200]
    TESTS.append(result)
    status_icon = "PASS" if status else "FAIL"
    try:
        print(f"\n[{status_icon}] {name} ({response_time:.2f}s)")
        if error:
            print(f"   Error: {error}")
        elif isinstance(response_data, dict):
            preview = result.get("response_preview", "")
            if preview:
                print(f"   Response: {preview[:150]}")
    except UnicodeEncodeError:
        print(f"\n[{status_icon}] {name} ({response_time:.2f}s)")
        print("   (Response contained unicode characters that couldn't be printed)")


async def test_health():
    async with httpx.AsyncClient(timeout=15) as client:
        start = time.time()
        try:
            r = await client.get(f"{BASE_URL}/api/health", headers=HEADERS)
            data = r.json()
            elapsed = time.time() - start
            ok = r.status_code == 200 and data.get("status") == "healthy"
            log_result("Health Check", ok, elapsed, data)
            return ok
        except Exception as e:
            elapsed = time.time() - start
            log_result("Health Check", False, elapsed, None, error=e)
            return False


async def test_agent(name, method, path, payload=None, params=None):
    async with httpx.AsyncClient(timeout=60) as client:
        start = time.time()
        try:
            if method == "POST":
                r = await client.post(f"{BASE_URL}{path}", json=payload, headers=HEADERS)
            else:
                r = await client.get(f"{BASE_URL}{path}", params=params, headers=HEADERS)
            
            elapsed = time.time() - start
            data = r.json()
            ok = r.status_code == 200
            log_result(name, ok, elapsed, data)
            return ok
        except Exception as e:
            elapsed = time.time() - start
            log_result(name, False, elapsed, None, error=e)
            return False


async def main():
    print("=" * 60)
    print("  AGENTIC AI - Testing All 7 Agents")
    print("=" * 60)

    # Test 0: Health Check
    print("\n--- Health Check ---")
    await test_health()

    # Test 1: Retail Assistant Agent (sales query)
    print("\n--- Agent #1: Retail Assistant (Sales Query) ---")
    await test_agent(
        "Agent #1: Retail Assistant (Sales)",
        "POST", "/api/chat",
        payload={"query": "What is today's total sale?", "shop_id": "24"}
    )

    # Test 1b: Retail Assistant Agent (inventory query)
    print("\n--- Agent #1: Retail Assistant (Inventory Query) ---")
    await test_agent(
        "Agent #1: Retail Assistant (Inventory)",
        "POST", "/api/chat",
        payload={"query": "How much sugar is left in stock?", "shop_id": "24"}
    )

    # Test 2: Billing Agent
    print("\n--- Agent #2: Billing Agent ---")
    await test_agent(
        "Agent #2: Billing Agent",
        "POST", "/api/billing/voice",
        payload={"audio_text": "Add two milk packets", "shop_id": "24"}
    )

    # Test 3: Stock Ordering Agent
    print("\n--- Agent #3: Stock Ordering Agent ---")
    await test_agent(
        "Agent #3: Stock Ordering Agent",
        "POST", "/api/stock/analyze",
        payload={"product_name": "Sugar", "shop_id": "24"}
    )

    # Test 4: Forecast Agent
    print("\n--- Agent #4: Forecast Agent ---")
    await test_agent(
        "Agent #4: Forecast Agent",
        "GET", "/api/insights/forecast",
        params={"product_or_category": "overall sales"}
    )

    # Test 5: Anomaly Agent
    print("\n--- Agent #5: Anomaly Agent ---")
    await test_agent(
        "Agent #5: Anomaly Agent",
        "GET", "/api/insights/anomalies"
    )

    # Test 6: Staff Agent
    print("\n--- Agent #6: Staff Agent ---")
    await test_agent(
        "Agent #6: Staff Agent",
        "GET", "/api/staff/performance",
        params={"period": "weekly"}
    )

    # Test 7: Report Agent
    print("\n--- Agent #7: Report Agent ---")
    await test_agent(
        "Agent #7: Report Agent",
        "POST", "/api/reports/narrate",
        payload={"report_type": "daily", "shop_id": "24"}
    )

    # Summary
    print("\n" + "=" * 60)
    print("  TEST RESULTS SUMMARY")
    print("=" * 60)
    passed = sum(1 for t in TESTS if "PASS" in t["status"])
    total = len(TESTS)
    print(f"\n  {passed}/{total} tests passed\n")
    for t in TESTS:
        icon = "PASS" if "PASS" in t["status"] else "FAIL"
        print(f"  [{icon}]  {t['agent']}  ({t['response_time']})")
    print()


if __name__ == "__main__":
    asyncio.run(main())
