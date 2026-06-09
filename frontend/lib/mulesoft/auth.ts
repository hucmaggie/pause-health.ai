let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getMulesoftBearerToken(): Promise<string | null> {
  const clientId = process.env.AUTH0_MULESOFT_CLIENT_ID;
  const clientSecret = process.env.AUTH0_MULESOFT_CLIENT_SECRET;
  const domain = process.env.AUTH0_MULESOFT_DOMAIN;
  const audience = process.env.AUTH0_MULESOFT_AUDIENCE;

  if (!clientId || !clientSecret || !domain || !audience) return null;

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value;
  }

  const res = await fetch(`https://${domain}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      audience,
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });

  if (!res.ok) return null;
  const json = await res.json();
  if (!json.access_token) return null;

  cachedToken = {
    value: json.access_token,
    expiresAt: now + (json.expires_in ?? 86400) * 1000,
  };
  return cachedToken.value;
}
