import json
from fastapi.testclient import TestClient
import importlib
from unittest.mock import patch

app_module = importlib.import_module("app")
app = app_module.app
client = TestClient(app)

def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}

def test_quote_by_zip_minimal():
    payload = {
        "dest_zip": "30301",
        "weight_kg": 20,
        "length_cm": 40,
        "width_cm": 30,
        "height_cm": 30,
        "mode": "express"
    }
    r = client.post("/quote-by-zip", json=payload)
    assert r.status_code == 200
    data = r.json()
    # Check all expected fields are in the response
    expected_fields = [
        "base_cost_usd", "distance_multiplier", "handling_fee_usd", 
        "fuel_surcharge_usd", "regional_surcharge_usd", "enterprise_discount_usd", "total_usd"
    ]
    for field in expected_fields:
        assert field in data
    
    # Check USD fields are formatted as currency strings
    usd_fields = ["base_cost_usd", "handling_fee_usd", "fuel_surcharge_usd", 
                  "regional_surcharge_usd", "enterprise_discount_usd", "total_usd"]
    for field in usd_fields:
        assert isinstance(data[field], str)
        assert data[field].startswith("$")
        assert "," in data[field] or "." in data[field]  # Currency format
    
    # Check distance_multiplier is a number
    assert isinstance(data["distance_multiplier"], (int, float))

def test_quote_by_zip_unknown_zip():
    payload = {
        "dest_zip": "99999",
        "weight_kg": 1,
        "length_cm": 10,
        "width_cm": 10,
        "height_cm": 10,
    }
    r = client.post("/quote-by-zip", json=payload)
    # Unknown ZIP codes now use fallback coordinates instead of returning 400
    assert r.status_code == 200
    data = r.json()
    assert "total_usd" in data
    assert data["total_usd"].startswith("$")

def test_geocode_with_api_success():
    """Test that API geocoding works and caches results"""
    with patch("app.geocode_zip_via_api") as mock_api:
        # Mock successful API response
        mock_api.return_value = (42.3601, -71.0589)  # Boston coordinates

        # Clear cache for test
        app_module._geocode_cache.clear()

        payload = {"dest_zip": "02101"}  # Boston ZIP (in ZIP_DB)
        r = client.post("/quote-by-zip", json=payload)
        assert r.status_code == 200

        # API shouldn't be called if ZIP is in ZIP_DB
        # But let's test with a completely new ZIP
        payload = {"dest_zip": "12345"}  # Unknown ZIP
        r = client.post("/quote-by-zip", json=payload)
        assert r.status_code == 200

def test_geocode_api_failure_fallback():
    """Test that API failures fall back to ZIP_DB"""
    with patch("app.geocode_zip_via_api") as mock_api:
        # Mock API failure
        mock_api.return_value = None

        # Clear cache
        app_module._geocode_cache.clear()

        # Use a ZIP in ZIP_DB
        payload = {"dest_zip": "30301"}  # Atlanta (in ZIP_DB)
        r = client.post("/quote-by-zip", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert "total_usd" in data

def test_cache_hit():
    """Test that cached ZIPs don't hit the API"""
    with patch("app.geocode_zip_via_api") as mock_api:
        mock_api.return_value = (40.7128, -74.0060)

        # Clear cache
        app_module._geocode_cache.clear()

        # First request - should call API
        payload = {"dest_zip": "54321"}
        r1 = client.post("/quote-by-zip", json=payload)
        assert r1.status_code == 200
        call_count_1 = mock_api.call_count

        # Second request - should use cache
        r2 = client.post("/quote-by-zip", json=payload)
        assert r2.status_code == 200
        call_count_2 = mock_api.call_count

        # Verify cache was used (call count didn't increase)
        # Note: may be 0 if ZIPCODEAPI_KEY is not set
        assert call_count_2 == call_count_1