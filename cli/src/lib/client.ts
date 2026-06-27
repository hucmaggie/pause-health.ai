/**
 * Tiny HTTP client used by every command. Same shape as
 * mcp/src/tools.ts's callExperienceApi so the CLI and the MCP server
 * speak to the same surface in the same way.
 *
 * Errors surface with the path that failed; the outer error handler in
 * cli.ts prepends `pause:` and exits non-zero.
 */
export type CallOptions = {
  baseUrl: string;
  path: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

export async function callExperienceApi<T = unknown>(
  opts: CallOptions
): Promise<T> {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}${opts.path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "@pause-health/cli"
  };
  const apiKey = opts.apiKey ?? process.env.PAUSE_API_KEY;
  if (apiKey && apiKey.length > 0) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url, { headers });
  if (!res.ok) {
    let bodyHint = "";
    try {
      const text = await res.text();
      if (text) bodyHint = ` — ${text.slice(0, 200)}`;
    } catch {
      bodyHint = "";
    }
    throw new Error(
      `GET ${opts.path} → HTTP ${res.status} ${res.statusText}${bodyHint}`
    );
  }
  return (await res.json()) as T;
}
