/**
 * MCP host for the Pause Care Router.
 *
 * Per-request multi-server MCP client. Lets our agents register
 * external MCP servers (Salesforce / Heroku Managed MCP / partner
 * Apex tools) and call their tools as part of a routing decision.
 *
 * Per-request lifecycle is intentional: serverless invocations on
 * Vercel are short-lived and any module-level singleton would
 * re-introduce cold-start staleness and per-deployment ordering
 * surprises. The cost is a fresh MCP handshake on each call —
 * acceptable given the Care Router already makes several remote
 * calls per request.
 *
 * Two remote slots ship today:
 *
 *   1. `loopback`  — the Pause MCP server at <origin>/api/mcp.
 *      Always-on demo path; verifies the host architecture against
 *      our own four tools without a partner dependency.
 *   2. `external`  — a single configurable slot driven by the
 *      `PAUSE_MCP_HOST_REMOTES` env var (JSON-encoded array of
 *      `{ id, url, headers? }`). When unset, the slot is empty
 *      and host calls fall back to loopback only.
 *
 * The host never throws on remote failure. Each `callTool` returns
 * a discriminated result and the caller decides whether to
 * fall back, retry, or surface the error to the agent fabric.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type MCPRemoteConfig = {
  /** Stable identifier for this remote (used in traces + diagnostics). */
  id: string;
  /** Streamable HTTP endpoint URL. */
  url: string;
  /** Optional headers (e.g. Bearer token). Sent on every JSON-RPC call. */
  headers?: Record<string, string>;
};

export type MCPToolResult =
  | { ok: true; remoteId: string; content: unknown; isError: false }
  | { ok: false; remoteId: string; error: string };

export type MCPHostConfig = {
  /** Remotes to connect to in order. The first one to return ok wins. */
  remotes: MCPRemoteConfig[];
  /** Override the SDK Client factory for tests. */
  clientFactory?: () => Client;
  /** Override transport factory for tests. */
  transportFactory?: (remote: MCPRemoteConfig) => MCPTransportLike;
  /** Per-call timeout in ms. Default 8000. */
  timeoutMs?: number;
};

/**
 * Minimal transport interface so tests can substitute without pulling
 * the real Streamable HTTP transport over an in-process loop.
 */
export interface MCPTransportLike {
  start(): Promise<void>;
  close(): Promise<void>;
  send: (...args: unknown[]) => Promise<void>;
  onmessage?: ((message: unknown) => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;
  onclose?: (() => void) | undefined;
}

/**
 * Parse `PAUSE_MCP_HOST_REMOTES` (a JSON array) plus the always-on
 * loopback. The loopback URL is derived from the request origin so
 * preview deployments host themselves; production hosts production.
 *
 * Returns the ordered list of remotes the host will try. Loopback is
 * always position 0 unless explicitly disabled by setting
 * `PAUSE_MCP_HOST_LOOPBACK=off`.
 */
export function resolveRemotesFromEnv(origin: string): MCPRemoteConfig[] {
  const remotes: MCPRemoteConfig[] = [];
  const loopback = (process.env.PAUSE_MCP_HOST_LOOPBACK ?? "on").trim().toLowerCase();
  if (loopback !== "off") {
    remotes.push({
      id: "loopback",
      url: `${origin.replace(/\/+$/, "")}/api/mcp`
    });
  }
  const rawExternal = process.env.PAUSE_MCP_HOST_REMOTES?.trim();
  if (rawExternal) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawExternal);
    } catch {
      // Configuration error — surface a console.warn so it shows up in
      // the deployment logs, then proceed with loopback only.
      console.warn(
        "[mcp-host] PAUSE_MCP_HOST_REMOTES is not valid JSON; ignoring."
      );
      return remotes;
    }
    if (!Array.isArray(parsed)) {
      console.warn(
        "[mcp-host] PAUSE_MCP_HOST_REMOTES must be a JSON array; ignoring."
      );
      return remotes;
    }
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as { id?: unknown }).id === "string" &&
        typeof (entry as { url?: unknown }).url === "string"
      ) {
        const candidate = entry as {
          id: string;
          url: string;
          headers?: Record<string, string>;
        };
        remotes.push({
          id: candidate.id,
          url: candidate.url,
          headers: candidate.headers
        });
      } else {
        console.warn(
          "[mcp-host] PAUSE_MCP_HOST_REMOTES entry missing id/url; skipped:",
          JSON.stringify(entry)
        );
      }
    }
  }
  return remotes;
}

/**
 * A connected MCP host. One instance covers one request — `close()`
 * tears down every transport when the routing decision is done.
 */
export class MCPHost {
  private readonly remotes: MCPRemoteConfig[];
  private readonly timeoutMs: number;
  private readonly clients = new Map<string, Client>();
  private readonly transports = new Map<string, MCPTransportLike>();
  private readonly clientFactory: () => Client;
  private readonly transportFactory: (
    remote: MCPRemoteConfig
  ) => MCPTransportLike;

  constructor(config: MCPHostConfig) {
    this.remotes = config.remotes;
    this.timeoutMs = config.timeoutMs ?? 8_000;
    this.clientFactory =
      config.clientFactory ??
      (() =>
        new Client(
          { name: "pause-care-router-mcp-host", version: "0.1.0" },
          { capabilities: {} }
        ));
    this.transportFactory =
      config.transportFactory ??
      ((remote) => {
        const requestInit: RequestInit = remote.headers
          ? { headers: remote.headers }
          : {};
        return new StreamableHTTPClientTransport(new URL(remote.url), {
          requestInit
        }) as unknown as MCPTransportLike;
      });
  }

  /**
   * Returns the resolved remote configurations the host will iterate.
   * Useful for traces / diagnostics.
   */
  listRemotes(): MCPRemoteConfig[] {
    return [...this.remotes];
  }

  /**
   * Call a tool against each registered remote in order. Returns the
   * first ok result; if every remote errors, returns the last failure.
   * Returns `undefined` if no remotes are configured.
   */
  async callTool(params: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<MCPToolResult | undefined> {
    if (this.remotes.length === 0) return undefined;
    let lastError: MCPToolResult | undefined;
    for (const remote of this.remotes) {
      try {
        const client = await this.clientFor(remote);
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), this.timeoutMs);
        try {
          const result = await client.callTool(params);
          if (result.isError) {
            lastError = {
              ok: false,
              remoteId: remote.id,
              error: `tool ${params.name} returned isError=true`
            };
            continue;
          }
          return {
            ok: true,
            remoteId: remote.id,
            content: result.content,
            isError: false
          };
        } finally {
          clearTimeout(t);
        }
      } catch (err) {
        lastError = {
          ok: false,
          remoteId: remote.id,
          error: (err as Error).message
        };
      }
    }
    return lastError;
  }

  /**
   * Tear down every transport. Idempotent.
   */
  async close(): Promise<void> {
    const transports = [...this.transports.values()];
    this.transports.clear();
    this.clients.clear();
    await Promise.allSettled(transports.map((t) => t.close()));
  }

  private async clientFor(remote: MCPRemoteConfig): Promise<Client> {
    const cached = this.clients.get(remote.id);
    if (cached) return cached;
    const client = this.clientFactory();
    const transport = this.transportFactory(remote);
    // The SDK's Client.connect(transport) accepts the SDK's concrete
    // transport type; our test-shim shape is intentionally
    // structurally-compatible, so cast at the boundary.
    await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
    this.clients.set(remote.id, client);
    this.transports.set(remote.id, transport);
    return client;
  }
}

/**
 * Convenience: build a per-request host from the env, deriving the
 * loopback origin from the incoming Request. Use this from API route
 * handlers.
 */
export function createMCPHostFromRequest(req: Request): MCPHost {
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;
  return new MCPHost({ remotes: resolveRemotesFromEnv(origin) });
}
