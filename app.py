from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Literal, Dict, Tuple
import math
import os
import requests
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Configuration
ZIPCODEAPI_KEY = os.getenv("ZIPCODEAPI_KEY")
GEOCODE_TIMEOUT = 3  # seconds

# In-memory cache for geocoded ZIP codes
_geocode_cache: Dict[str, Tuple[float, float]] = {}

app = FastAPI(title="Northstar Logistics - Shipping Cost by ZIP")

# ---------------- Knowledge Article 1 anchors ----------------
# Fees depend on:
# 1) package weight & dimensions (oversize/overweight may add handling),
# 2) delivery distance & mode (ground/air/express have different rate structures),
# 3) monthly fuel & regional surcharges.
#
# Example used for sanity checks in test data:
# "A 20 kg express shipment from Los Angeles to Atlanta ~ $55 incl. surcharges."
# (Adjust tunables to match this ballpark if desired.)

# ---------------- Comprehensive US ZIP Code Database ----------------
# NOTE: This is a subset of major US ZIP codes. For production, integrate with a full ZIP code service.
ZIP_DB: Dict[str, Tuple[float, float]] = {
    # Major US Cities and Metropolitan Areas
    # California
    "90001": (33.973951, -118.248405),  # Los Angeles, CA
    "90210": (34.0901, -118.4065),     # Beverly Hills, CA
    "94105": (37.7898, -122.3942),      # San Francisco, CA
    "92101": (32.7157, -117.1611),     # San Diego, CA
    "95814": (38.5816, -121.4944),     # Sacramento, CA
    "95110": (37.3382, -121.8863),     # San Jose, CA
    
    # New York
    "10001": (40.750742, -73.99653),    # New York, NY
    "10013": (40.7182, -74.0086),      # New York, NY (Tribeca)
    "10018": (40.7505, -73.9934),      # New York, NY (Times Square)
    "11201": (40.6943, -73.9249),      # Brooklyn, NY
    
    # Illinois
    "60601": (41.886258, -87.618844),  # Chicago, IL
    "60611": (41.8995, -87.6272),      # Chicago, IL (Gold Coast)
    "60614": (41.9201, -87.6538),      # Chicago, IL (Lincoln Park)
    
    # Texas
    "73301": (30.267153, -97.743057),  # Austin, TX
    "77001": (29.7604, -95.3698),     # Houston, TX
    "75201": (32.7767, -96.7970),      # Dallas, TX
    "78201": (29.4241, -98.4936),      # San Antonio, TX
    
    # Florida
    "33101": (25.7617, -80.1918),      # Miami, FL
    "32801": (28.5383, -81.3792),      # Orlando, FL
    "33601": (27.9506, -82.4572),      # Tampa, FL
    "32201": (30.3322, -81.6557),      # Jacksonville, FL
    
    # Georgia
    "30301": (33.752880, -84.392708),  # Atlanta, GA
    "30309": (33.7890, -84.3847),      # Atlanta, GA (Midtown)
    
    # Washington
    "98101": (47.6062, -122.3321),     # Seattle, WA
    "98102": (47.6062, -122.3321),     # Seattle, WA (Capitol Hill)
    
    # Massachusetts
    "02101": (42.3601, -71.0589),      # Boston, MA
    "02108": (42.3601, -71.0589),      # Boston, MA (Downtown)
    
    # Pennsylvania
    "19101": (39.9526, -75.1652),      # Philadelphia, PA
    "15201": (40.4406, -79.9959),      # Pittsburgh, PA
    
    # Arizona
    "85001": (33.4484, -112.0740),     # Phoenix, AZ
    "85701": (32.2226, -110.9747),     # Tucson, AZ
    
    # Colorado
    "80201": (39.7392, -104.9903),     # Denver, CO
    "80301": (40.0150, -105.2705),     # Boulder, CO
    
    # Nevada
    "89101": (36.1699, -115.1398),     # Las Vegas, NV
    "89501": (39.5296, -119.8138),     # Reno, NV
    
    # Oregon
    "97201": (45.5152, -122.6784),     # Portland, OR
    
    # Utah
    "84101": (40.7608, -111.8910),     # Salt Lake City, UT
    
    # New Mexico
    "87101": (35.0844, -106.6504),     # Albuquerque, NM
    
    # Oklahoma
    "73101": (35.4676, -97.5164),      # Oklahoma City, OK
    
    # Kansas
    "66101": (39.1142, -94.6275),      # Kansas City, KS
    
    # Missouri
    "64101": (39.0997, -94.5786),      # Kansas City, MO
    "63101": (38.6270, -90.1994),      # St. Louis, MO
    
    # Arkansas
    "72201": (34.7465, -92.2896),      # Little Rock, AR
    
    # Louisiana
    "70112": (29.9511, -90.0715),     # New Orleans, LA
    
    # Mississippi
    "39201": (32.2988, -90.1848),      # Jackson, MS
    
    # Alabama
    "35201": (33.5186, -86.8025),      # Birmingham, AL
    
    # Tennessee
    "37201": (36.1627, -86.7816),      # Nashville, TN
    "38101": (35.1495, -90.0490),      # Memphis, TN
    
    # Kentucky
    "40201": (38.2527, -85.7585),      # Louisville, KY
    
    # Ohio
    "43201": (39.9612, -82.9988),      # Columbus, OH
    "44101": (41.4993, -81.6944),      # Cleveland, OH
    "45201": (39.1031, -84.5120),      # Cincinnati, OH
    
    # Indiana
    "46201": (39.7684, -86.1581),      # Indianapolis, IN
    
    # Michigan
    "48201": (42.3314, -83.0458),      # Detroit, MI
    
    # Wisconsin
    "53201": (43.0389, -87.9065),      # Milwaukee, WI
    
    # Minnesota
    "55401": (44.9778, -93.2650),      # Minneapolis, MN
    
    # Iowa
    "50301": (41.5868, -93.6250),      # Des Moines, IA
    
    # Nebraska
    "68101": (41.2565, -95.9345),      # Omaha, NE
    
    # North Dakota
    "58101": (46.8772, -96.7898),      # Fargo, ND
    
    # South Dakota
    "57101": (43.5446, -96.7311),      # Sioux Falls, SD
    
    # Montana
    "59101": (45.7833, -108.5007),     # Billings, MT
    
    # Wyoming
    "82001": (41.1390, -104.8192),     # Cheyenne, WY
    
    # Idaho
    "83701": (43.6150, -116.2023),     # Boise, ID
    
    # Alaska
    "99501": (61.2181, -149.9003),     # Anchorage, AK
    
    # Hawaii
    "96801": (21.3099, -157.8581),     # Honolulu, HI
    
    # Vermont
    "05401": (44.4759, -73.2121),      # Burlington, VT
    
    # New Hampshire
    "03101": (43.1939, -71.5724),      # Manchester, NH
    
    # Maine
    "04101": (43.6591, -70.2568),      # Portland, ME
    
    # Rhode Island
    "02901": (41.8240, -71.4128),      # Providence, RI
    
    # Connecticut
    "06101": (41.7658, -72.6734),      # Hartford, CT
    
    # New Jersey
    "07101": (40.7178, -74.0431),      # Newark, NJ
    
    # Delaware
    "19801": (39.7391, -75.5398),      # Wilmington, DE
    
    # Maryland
    "21201": (39.2904, -76.6122),      # Baltimore, MD
    
    # West Virginia
    "25301": (38.3498, -81.6326),     # Charleston, WV
    
    # Virginia
    "23219": (37.5407, -77.4360),      # Richmond, VA
    "22201": (38.8816, -77.0910),      # Arlington, VA
    
    # North Carolina
    "27601": (35.7796, -78.6382),      # Raleigh, NC
    "28201": (35.2271, -80.8431),      # Charlotte, NC
    
    # South Carolina
    "29201": (34.0007, -81.0348),      # Columbia, SC
    
}

def geocode_zip_via_api(zip_code: str) -> Optional[Tuple[float, float]]:
    """
    Geocode a ZIP code using ZipCodeAPI.com

    Returns:
        Tuple of (lat, lon) if successful, None if failed
    """
    if not ZIPCODEAPI_KEY:
        return None

    try:
        url = f"https://www.zipcodeapi.com/rest/{ZIPCODEAPI_KEY}/info.json/{zip_code}/degrees"
        response = requests.get(url, timeout=GEOCODE_TIMEOUT)

        # Handle various API error responses
        if response.status_code == 404:
            # Invalid ZIP code
            return None
        elif response.status_code == 403:
            # Invalid API key
            return None
        elif response.status_code == 429:
            # Rate limit exceeded
            return None

        response.raise_for_status()
        data = response.json()

        # Extract lat/lon from response
        lat = float(data.get("lat", 0))
        lng = float(data.get("lng", 0))

        if lat == 0 and lng == 0:
            return None

        return (lat, lng)

    except (requests.RequestException, ValueError, KeyError):
        # Network error, timeout, or invalid response format
        return None

def _state_based_fallback(zip_code: str) -> Tuple[float, float]:
    """Fallback to state-based approximation for unknown ZIP codes"""
    state_fallbacks = {
        "CA": (34.0522, -118.2437),  # Los Angeles, CA
        "NY": (40.7128, -74.0060),  # New York, NY
        "TX": (31.9686, -99.9018),   # Central Texas
        "FL": (27.7663, -82.6404),  # Tampa, FL
        "IL": (41.8781, -87.6298),  # Chicago, IL
        "PA": (39.9526, -75.1652),  # Philadelphia, PA
        "OH": (39.9612, -82.9988),  # Columbus, OH
        "GA": (33.7490, -84.3880),  # Atlanta, GA
        "NC": (35.2271, -80.8431),  # Charlotte, NC
        "MI": (42.3314, -83.0458),  # Detroit, MI
        "NJ": (40.7178, -74.0431),  # Newark, NJ
        "VA": (37.5407, -77.4360),  # Richmond, VA
        "WA": (47.6062, -122.3321), # Seattle, WA
        "AZ": (33.4484, -112.0740), # Phoenix, AZ
        "MA": (42.3601, -71.0589),  # Boston, MA
        "TN": (36.1627, -86.7816),  # Nashville, TN
        "IN": (39.7684, -86.1581),  # Indianapolis, IN
        "MO": (38.6270, -90.1994),  # St. Louis, MO
        "MD": (39.2904, -76.6122),  # Baltimore, MD
        "WI": (43.0389, -87.9065),  # Milwaukee, WI
        "CO": (39.7392, -104.9903), # Denver, CO
        "MN": (44.9778, -93.2650),  # Minneapolis, MN
        "SC": (34.0007, -81.0348),  # Columbia, SC
        "AL": (33.5186, -86.8025),  # Birmingham, AL
        "LA": (29.9511, -90.0715),  # New Orleans, LA
        "KY": (38.2527, -85.7585),  # Louisville, KY
        "OR": (45.5152, -122.6784), # Portland, OR
        "OK": (35.4676, -97.5164),  # Oklahoma City, OK
        "CT": (41.7658, -72.6734),  # Hartford, CT
        "UT": (40.7608, -111.8910), # Salt Lake City, UT
        "IA": (41.5868, -93.6250),  # Des Moines, IA
        "NV": (36.1699, -115.1398), # Las Vegas, NV
        "AR": (34.7465, -92.2896),  # Little Rock, AR
        "MS": (32.2988, -90.1848),  # Jackson, MS
        "KS": (39.1142, -94.6275),  # Kansas City, KS
        "NM": (35.0844, -106.6504), # Albuquerque, NM
        "NE": (41.2565, -95.9345),  # Omaha, NE
        "WV": (38.3498, -81.6326),  # Charleston, WV
        "ID": (43.6150, -116.2023), # Boise, ID
        "HI": (21.3099, -157.8581), # Honolulu, HI
        "NH": (43.1939, -71.5724),  # Manchester, NH
        "ME": (43.6591, -70.2568),  # Portland, ME
        "RI": (41.8240, -71.4128),  # Providence, RI
        "VT": (44.4759, -73.2121),  # Burlington, VT
        "DE": (39.7391, -75.5398),  # Wilmington, DE
        "SD": (43.5446, -96.7311),  # Sioux Falls, SD
        "ND": (46.8772, -96.7898),  # Fargo, ND
        "MT": (45.7833, -108.5007), # Billings, MT
        "WY": (41.1390, -104.8192), # Cheyenne, WY
        "AK": (61.2181, -149.9003), # Anchorage, AK
    }

    # Try to determine state from ZIP code (simplified approach)
    # US ZIP codes: 0xxxx-9xxxx, where first digit indicates region
    first_digit = zip_code[0] if zip_code else "0"

    region_mapping = {
        "0": "NJ", "1": "NY", "2": "DC", "3": "FL", "4": "GA",
        "5": "CA", "6": "IL", "7": "TX", "8": "CO", "9": "CA"
    }

    state = region_mapping.get(first_digit, "CA")
    return state_fallbacks.get(state, (34.0522, -118.2437))  # Default to LA

def get_zip_coordinates(zip_code: str) -> Tuple[float, float]:
    """
    Get coordinates for a ZIP code using three-tier lookup strategy:
    1. Check in-memory cache
    2. Try ZipCodeAPI.com (if API key configured)
    3. Fallback to hardcoded ZIP_DB
    4. Final fallback to state-based approximation
    """
    # Tier 1: Check in-memory cache
    if zip_code in _geocode_cache:
        return _geocode_cache[zip_code]

    # Tier 2: Try API call (if API key configured)
    if ZIPCODEAPI_KEY:
        api_result = geocode_zip_via_api(zip_code)
        if api_result:
            # Cache the successful result
            _geocode_cache[zip_code] = api_result
            return api_result

    # Tier 3: Fallback to hardcoded ZIP_DB
    if zip_code in ZIP_DB:
        coords = ZIP_DB[zip_code]
        # Cache the hardcoded result for consistency
        _geocode_cache[zip_code] = coords
        return coords

    # Tier 4: Final fallback to state-based approximation
    coords = _state_based_fallback(zip_code)
    # Cache the fallback result
    _geocode_cache[zip_code] = coords
    return coords

def haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    (lat1, lon1), (lat2, lon2) = a, b
    R = 6371.0088
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    h = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlmb/2)**2
    return 2*R*math.asin(math.sqrt(h))

# ---------------- Pricing tunables (transparent & tweakable) ----------------
DIM_DIVISOR_CM3_PER_KG = 5000.0  # common DIM factor
MODE_RATE_PER_KG = {"ground": 0.80, "air": 1.60, "express": 2.00}

def distance_multiplier(distance_km: float) -> float:
    # +5% per 1,000 km
    return 1.0 + 0.05 * (distance_km / 1000.0)

def handling_fee(weight_kg: float, length_cm: float, width_cm: float, height_cm: float) -> float:
    oversize = any(x > 100 for x in [length_cm, width_cm, height_cm]) or (length_cm + 2*(width_cm + height_cm)) > 300
    overweight = weight_kg > 30
    fee = 0.0
    if oversize:  fee += 10.0
    if overweight: fee += 15.0
    return fee

def round2(x: float) -> float:
    return round(float(x) + 1e-9, 2)

def format_currency(amount: float) -> str:
    """Format amount as US currency with $, commas, and 2 decimals"""
    return f"${amount:,.2f}"

# ---------------- Request/Response models ----------------
class ZipQuoteRequest(BaseModel):
    # Only the destination ZIP is required; all other fields have sensible defaults
    dest_zip: str = Field(description="Destination ZIP code")
    origin_zip: Optional[str] = Field(default="90001", description="Origin ZIP (defaults to Northstar LA DC)")
    weight_kg: Optional[float] = Field(default=1.0, gt=0, description="Package weight in kg (default: 1.0 kg)")
    length_cm: Optional[float] = Field(default=30.0, gt=0, description="Package length in cm (default: 30.0 cm)")
    width_cm: Optional[float] = Field(default=20.0, gt=0, description="Package width in cm (default: 20.0 cm)")
    height_cm: Optional[float] = Field(default=10.0, gt=0, description="Package height in cm (default: 10.0 cm)")
    mode: Optional[Literal["ground", "air", "express"]] = Field(default="ground", description="Shipping mode (default: ground)")
    fuel_surcharge_pct: Optional[float] = Field(default=12.0, ge=0, description="Fuel surcharge percentage (default: 12.0%)")
    regional_surcharge_pct: Optional[float] = Field(default=3.0, ge=0, description="Regional surcharge percentage (default: 3.0%)")
    enterprise_rate_card: Optional[bool] = Field(default=False, description="Apply enterprise discount (default: False)")

class ZipQuoteResponse(BaseModel):
    base_cost_usd: str
    distance_multiplier: float
    handling_fee_usd: str
    fuel_surcharge_usd: str
    regional_surcharge_usd: str
    enterprise_discount_usd: str
    total_usd: str

# ---------------- Core cost calculation (re-uses KA1 logic) ----------------
def compute_cost_from_distance_km(distance_km: float, *, weight_kg: float, length_cm: float, width_cm: float, height_cm: float,
                                  mode: str, fuel_pct: float, regional_pct: float, enterprise: bool) -> ZipQuoteResponse:
    dim_weight = (length_cm * width_cm * height_cm) / DIM_DIVISOR_CM3_PER_KG
    chargeable = max(weight_kg, dim_weight)
    rate = MODE_RATE_PER_KG[mode]
    base = chargeable * rate
    dmult = distance_multiplier(distance_km)
    base_adj = base * dmult
    h_fee = handling_fee(weight_kg, length_cm, width_cm, height_cm)
    fuel_fee = (fuel_pct / 100.0) * (base_adj + h_fee)
    regional_fee = (regional_pct / 100.0) * (base_adj + h_fee + fuel_fee)
    enterprise_discount = 0.10 * (base_adj + h_fee + fuel_fee + regional_fee) if enterprise else 0.0
    total = base_adj + h_fee + fuel_fee + regional_fee - enterprise_discount
    return ZipQuoteResponse(
        base_cost_usd=format_currency(round2(base)),
        distance_multiplier=round2(dmult),
        handling_fee_usd=format_currency(round2(h_fee)),
        fuel_surcharge_usd=format_currency(round2(fuel_fee)),
        regional_surcharge_usd=format_currency(round2(regional_fee)),
        enterprise_discount_usd=format_currency(round2(enterprise_discount)),
        total_usd=format_currency(round2(total))
    )

# ---------------- REST endpoint ----------------
@app.post("/quote-by-zip", response_model=ZipQuoteResponse)
def quote_by_zip(req: ZipQuoteRequest):
    # Use defaults for optional fields if not provided
    origin_zip = req.origin_zip or "90001"
    weight_kg = req.weight_kg or 1.0
    length_cm = req.length_cm or 30.0
    width_cm = req.width_cm or 20.0
    height_cm = req.height_cm or 10.0
    mode = req.mode or "ground"
    fuel_pct = req.fuel_surcharge_pct or 12.0
    regional_pct = req.regional_surcharge_pct or 3.0
    enterprise = req.enterprise_rate_card or False
    
    # Get coordinates for both ZIP codes (with fallback for unknown ZIPs)
    origin_ll = get_zip_coordinates(origin_zip)
    dest_ll = get_zip_coordinates(req.dest_zip)
    distance_km = haversine_km(origin_ll, dest_ll)

    resp = compute_cost_from_distance_km(
        distance_km,
        weight_kg=weight_kg,
        length_cm=length_cm,
        width_cm=width_cm,
        height_cm=height_cm,
        mode=mode,
        fuel_pct=fuel_pct,
        regional_pct=regional_pct,
        enterprise=enterprise,
    )
    return resp

# ---------------- Health check ----------------
@app.get('/health')
def health():
    return {'status': 'ok'}
