import { describe, expect, it } from "vitest";
import { POST } from "./route";
import {
  PENDING_COOKIE_NAME,
  SESSION_COOKIE_NAME
} from "../../../../../lib/salesforce-headless360";

/**
 * POST /api/salesforce/headless-360/logout — clears both Pause-side cookies.
 * Env-independent (no Salesforce call), always 200.
 */
describe("POST /logout", () => {
  it("returns 200 { ok: true } and expires both the session and pending cookies", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const cookies = res.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith(SESSION_COOKIE_NAME));
    const pending = cookies.find((c) => c.startsWith(PENDING_COOKIE_NAME));
    expect(session).toContain("Max-Age=0");
    expect(pending).toContain("Max-Age=0");
    // Cleared cookies keep the hardened flags so they overwrite the originals.
    expect(session).toContain("HttpOnly");
    expect(session).toContain("Secure");
    expect(session).toContain("SameSite=Lax");
  });
});
