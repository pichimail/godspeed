#!/usr/bin/env python3
"""
Test script for Mac System Tools integration
Verifies all API endpoints are working
"""

import requests
import json
import sys

BASE_URL = "http://localhost:8000"

def test_endpoint(method, endpoint, data=None, description=""):
    """Test a single endpoint"""
    url = f"{BASE_URL}{endpoint}"
    try:
        if method == "GET":
            response = requests.get(url)
        elif method == "POST":
            response = requests.post(url, json=data or {})
        elif method == "DELETE":
            response = requests.delete(url, json=data or {})

        if response.status_code == 200:
            result = response.json()
            if result.get("success"):
                print(f"✅ {description}: PASS")
                return True
            else:
                print(f"❌ {description}: FAIL - {result.get('error', 'Unknown error')}")
                return False
        else:
            print(f"❌ {description}: FAIL - HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ {description}: ERROR - {str(e)}")
        return False

def main():
    print("🧪 Testing Mac System Tools Integration\n")
    print("=" * 60)

    tests = [
        # Storage & Disk
        ("GET", "/api/system-tools/disk/usage", None, "Disk Usage"),
        ("GET", "/api/system-tools/storage/analyze?limit=10", None, "Storage Analysis"),
        ("GET", "/api/system-tools/storage/breakdown", None, "Storage Breakdown"),

        # System Monitoring
        ("GET", "/api/system-tools/system/health", None, "System Health"),

        # Dev Tools
        ("GET", "/api/system-tools/dev/ports", None, "List Busy Ports"),

        # Note: Skip destructive tests by default
        # ("POST", "/api/system-tools/cleanup/light", {}, "Light Cleanup"),
        # ("POST", "/api/system-tools/ram/purge", {}, "RAM Purge"),
    ]

    passed = 0
    failed = 0

    for method, endpoint, data, description in tests:
        if test_endpoint(method, endpoint, data, description):
            passed += 1
        else:
            failed += 1

    print("=" * 60)
    print(f"\n📊 Results: {passed} passed, {failed} failed")

    if failed == 0:
        print("\n🎉 All tests passed! System Tools integration is working.")
        return 0
    else:
        print("\n⚠️  Some tests failed. Check the server logs for details.")
        return 1

if __name__ == "__main__":
    print("ℹ️  Make sure Odysseus is running on http://localhost:8000")
    print("ℹ️  Run: python app.py\n")
    sys.exit(main())
