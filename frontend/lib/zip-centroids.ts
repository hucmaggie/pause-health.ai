/**
 * Server-only ZIP → (latitude, longitude) lookup.
 *
 * Backed by `zip-centroids.generated.json`, which is the Census 2020 ZCTA
 * gazetteer compressed into a 5-digit-ZIP map by `provider_ingest/centroids.py`.
 * The same file ships in both repos so the build-time stamping (Python) and
 * the request-time resolution (here) draw from one source of truth.
 *
 * Only the route handler (`/api/mulesoft/providers`) and the prefer-real
 * client import this module — both run on the server — so the 1 MB JSON
 * never reaches the client bundle.
 */

import centroidData from "./zip-centroids.generated.json";

type LatLng = { latitude: number; longitude: number };

const CENTROIDS = centroidData as unknown as Record<string, [number, number]>;

/**
 * Resolve a USPS ZIP (3-5 digits) to its ZCTA centroid, or `null` if none is
 * known. 5-digit input is preferred; for 3-digit input we walk the prefix
 * to the first matching ZCTA — coarser, but enough for the directory's
 * proximity ranking when the patient only has a partial ZIP.
 */
export function lookupZipCentroid(zip: string | null | undefined): LatLng | null {
  if (!zip) return null;
  const trimmed = zip.trim();
  if (!/^\d{3,5}$/.test(trimmed)) return null;

  if (trimmed.length === 5) {
    const hit = CENTROIDS[trimmed];
    return hit ? { latitude: hit[0], longitude: hit[1] } : null;
  }

  // 3- or 4-digit prefix: scan once to find any matching 5-digit ZCTA.
  for (const z of Object.keys(CENTROIDS)) {
    if (z.startsWith(trimmed)) {
      const hit = CENTROIDS[z];
      return { latitude: hit[0], longitude: hit[1] };
    }
  }
  return null;
}
