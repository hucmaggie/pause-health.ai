/**
 * Google Agent-to-Agent Protocol (A2A) types and helpers.
 *
 * Implements a faithful subset of the Linux Foundation A2A specification
 * v1 that Pause-Health.ai uses to hand off a captured intake record from
 * the Agentforce Service Agent to the Anthropic-backed Care Router agent.
 *
 * See: https://google-a2a.github.io/A2A/specification
 *
 * Subset implemented:
 *   - AgentCard discovery (well-known JSON document at
 *     /.well-known/agent.json for each agent endpoint)
 *   - Task lifecycle (submitted -> working -> completed | failed |
 *     input-required)
 *   - Single-turn tasks/send JSON-RPC method
 *   - Message + Artifact (text only; no multimodal in the prototype)
 *
 * Out of scope for the prototype (documented but not implemented):
 *   - tasks/sendSubscribe SSE streaming
 *   - tasks/cancel and tasks/get polling
 *   - Push notifications (webhook callbacks)
 *   - OAuth/mTLS between agents (the prototype is open by default and
 *     governed only by the in-process MuleSoft Agent Fabric mock)
 */

export type A2ATaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "canceled";

export type A2ATextPart = {
  type: "text";
  text: string;
};

export type A2ADataPart = {
  type: "data";
  data: Record<string, unknown>;
};

export type A2APart = A2ATextPart | A2ADataPart;

export type A2AMessage = {
  role: "user" | "agent";
  parts: A2APart[];
  /** ISO-8601 timestamp the message was emitted. */
  timestamp: string;
};

export type A2AArtifact = {
  name: string;
  description?: string;
  parts: A2APart[];
  /** Monotonically increasing index within a task. */
  index: number;
};

export type A2ATaskStatus = {
  state: A2ATaskState;
  /** Most recent agent message, if any. */
  message?: A2AMessage;
  /** ISO-8601 timestamp of the last state transition. */
  timestamp: string;
};

export type A2ATask = {
  id: string;
  /** Optional session id grouping multiple tasks (intake -> routing). */
  sessionId?: string;
  status: A2ATaskStatus;
  history?: A2AMessage[];
  artifacts?: A2AArtifact[];
  /** Pause extension: link to the MuleSoft Agent Fabric trace. */
  metadata?: Record<string, unknown>;
};

/**
 * A2A Agent Card. The well-known discovery document served at
 * `<agentUrl>/.well-known/agent.json`. Subset of the full spec --
 * Pause's prototype agents only advertise what they actually implement.
 */
export type A2AAgentCard = {
  name: string;
  description: string;
  url: string;
  provider?: { organization: string; url?: string };
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: Array<{
    id: string;
    name: string;
    description: string;
    inputModes: string[];
    outputModes: string[];
    tags?: string[];
  }>;
  /** Pause extension: governance policies enforced for this agent. */
  pauseGovernance?: {
    fabricRegisteredAs: string;
    policies: string[];
  };
};

/**
 * JSON-RPC envelope used by A2A. All A2A traffic is JSON-RPC 2.0.
 */
export type A2ARpcRequest<TParams> = {
  jsonrpc: "2.0";
  id: string | number;
  method: "tasks/send" | "tasks/get" | "tasks/cancel";
  params: TParams;
};

export type A2ARpcResponse<TResult> = {
  jsonrpc: "2.0";
  id: string | number;
  result?: TResult;
  error?: { code: number; message: string; data?: unknown };
};

export type A2ATasksSendParams = {
  id: string;
  sessionId?: string;
  message: A2AMessage;
  metadata?: Record<string, unknown>;
};

/**
 * Generate a deterministic-but-unique task id. Pause uses a millisecond
 * timestamp + random suffix so tasks sort chronologically in the
 * Agent Fabric trace viewer.
 */
export function newTaskId(prefix = "task"): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Minimal A2A client. Posts a `tasks/send` request to the target agent
 * URL and returns the resulting `A2ATask`.
 *
 * Used by:
 *   - The Agentforce intake fallback when it completes a draft (calls
 *     the Care Router agent over A2A).
 *   - The /demo/agent-fabric "Run test case" button.
 *
 * Errors are thrown as `Error` -- callers are expected to catch and
 * surface them to the UI / trace viewer.
 */
export async function sendA2ATask(
  agentUrl: string,
  params: A2ATasksSendParams,
  init?: { signal?: AbortSignal }
): Promise<A2ATask> {
  const body: A2ARpcRequest<A2ATasksSendParams> = {
    jsonrpc: "2.0",
    id: params.id,
    method: "tasks/send",
    params
  };
  const res = await fetch(`${agentUrl.replace(/\/+$/, "")}/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(body),
    signal: init?.signal
  });
  if (!res.ok) {
    throw new Error(`A2A ${res.status} ${res.statusText} from ${agentUrl}`);
  }
  const payload = (await res.json()) as A2ARpcResponse<A2ATask>;
  if (payload.error) {
    throw new Error(
      `A2A error from ${agentUrl}: ${payload.error.code} ${payload.error.message}`
    );
  }
  if (!payload.result) {
    throw new Error(`A2A response from ${agentUrl} missing result`);
  }
  return payload.result;
}

/**
 * Helper: build a single user-role text message in one line.
 */
export function userMessage(text: string, data?: Record<string, unknown>): A2AMessage {
  const parts: A2APart[] = [{ type: "text", text }];
  if (data) parts.push({ type: "data", data });
  return { role: "user", parts, timestamp: nowIso() };
}

/**
 * Helper: build a single agent-role text message in one line.
 */
export function agentMessage(text: string, data?: Record<string, unknown>): A2AMessage {
  const parts: A2APart[] = [{ type: "text", text }];
  if (data) parts.push({ type: "data", data });
  return { role: "agent", parts, timestamp: nowIso() };
}

/**
 * A2A spec-version tolerance. Early A2A drafts (which Pause's A2APart type
 * follows) discriminate Parts with `type` ("text" | "data"); the current
 * spec renamed the discriminator to `kind`. Pause continues to EMIT the
 * `type` form for its own agents, but any INBOUND endpoint (tasks/send)
 * must accept either so a spec-current external client -- Vertex AI Agent
 * Builder, an OpenAI Responses harness, a custom orchestrator -- is not
 * silently dropped (its data part ignored, its intake collapsed to {}).
 * These readers are deliberately defensive: they take `unknown` because
 * the bytes come off the wire, not from our own typed builders.
 */
export function partKind(part: unknown): string | undefined {
  if (!part || typeof part !== "object") return undefined;
  const p = part as { type?: unknown; kind?: unknown };
  if (typeof p.type === "string") return p.type;
  if (typeof p.kind === "string") return p.kind;
  return undefined;
}

/**
 * Return the `data` object of the first data Part in `parts`, accepting
 * either the `type:"data"` or `kind:"data"` discriminator. Returns
 * undefined when there is no data part, the part carries no object `data`,
 * or `parts` isn't an array. Text parts are skipped.
 */
export function findDataPart(parts: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(parts)) return undefined;
  for (const part of parts) {
    if (partKind(part) !== "data") continue;
    const data = (part as { data?: unknown }).data;
    if (data && typeof data === "object") {
      return data as Record<string, unknown>;
    }
  }
  return undefined;
}
