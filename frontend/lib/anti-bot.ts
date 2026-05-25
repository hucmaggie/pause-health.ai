export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MIN_HUMAN_FILL_MS = 1500;

export function isValidEmail(email: unknown): email is string {
  if (typeof email !== "string") return false;
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 254) return false;
  return EMAIL_RE.test(trimmed);
}

export function isHoneypotTriggered(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export function isTimeTrapTriggered(renderedAt: unknown, now: number = Date.now()): boolean {
  if (typeof renderedAt !== "number" || !Number.isFinite(renderedAt)) return false;
  if (renderedAt > now) return true;
  return now - renderedAt < MIN_HUMAN_FILL_MS;
}

export function isBotSubmission(payload: { website?: unknown; renderedAt?: unknown }): boolean {
  return isHoneypotTriggered(payload.website) || isTimeTrapTriggered(payload.renderedAt);
}

export function clientIpFromHeaders(headers: Headers): string | null {
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || null;
  return null;
}

export async function verifyTurnstile(
  token: string,
  remoteIp: string | null,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    const data = (await res.json().catch(() => null)) as { success?: boolean } | null;
    return !!data?.success;
  } catch {
    return false;
  }
}
