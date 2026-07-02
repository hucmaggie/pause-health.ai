import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentMessage,
  newTaskId,
  nowIso,
  sendA2ATask,
  userMessage,
  type A2ARpcRequest,
  type A2ARpcResponse,
  type A2ATask,
  type A2ATasksSendParams
} from "./a2a";

/**
 * Tests for lib/a2a.ts -- the client half of Pause's Google A2A subset.
 * The server half (/api/agents/care-router/tasks) has its own route test;
 * here we pin the client's request shaping and its four response outcomes
 * (ok, HTTP error, JSON-RPC error, missing result), plus the tiny message
 * builders the route handlers rely on.
 */

type FetchArgs = { url: string; init: RequestInit };

function stubFetch(
  responder: (args: FetchArgs) => {
    ok?: boolean;
    status?: number;
    statusText?: string;
    body: unknown;
  }
): () => FetchArgs[] {
  const calls: FetchArgs[] = [];
  const fake = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responder({ url, init });
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      statusText: r.statusText ?? "OK",
      json: async () => r.body
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fake);
  return () => calls;
}

const SAMPLE_PARAMS: A2ATasksSendParams = {
  id: "task-abc",
  sessionId: "sess-1",
  message: userMessage("route this", { intake: { severity: "moderate" } }),
  metadata: { parentSpanId: "span-parent" }
};

function completedTask(): A2ATask {
  return {
    id: "task-abc",
    sessionId: "sess-1",
    status: { state: "completed", timestamp: nowIso() }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendA2ATask · request shaping", () => {
  it("POSTs a JSON-RPC tasks/send envelope to <agentUrl>/tasks", async () => {
    const getCalls = stubFetch(() => ({ body: { result: completedTask() } }));
    await sendA2ATask("https://agent.example/api/agents/care-router", SAMPLE_PARAMS);

    const [call] = getCalls();
    expect(call.url).toBe(
      "https://agent.example/api/agents/care-router/tasks"
    );
    expect(call.init.method).toBe("POST");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(call.init.body as string) as A2ARpcRequest<A2ATasksSendParams>;
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-abc");
    expect(body.params.message.parts[0]).toMatchObject({ type: "text" });
  });

  it("strips a trailing slash from the agent url before appending /tasks", async () => {
    const getCalls = stubFetch(() => ({ body: { result: completedTask() } }));
    await sendA2ATask("https://agent.example/care-router///", SAMPLE_PARAMS);
    expect(getCalls()[0].url).toBe("https://agent.example/care-router/tasks");
  });

  it("forwards an AbortSignal to fetch", async () => {
    const getCalls = stubFetch(() => ({ body: { result: completedTask() } }));
    const controller = new AbortController();
    await sendA2ATask("https://agent.example", SAMPLE_PARAMS, {
      signal: controller.signal
    });
    expect(getCalls()[0].init.signal).toBe(controller.signal);
  });
});

describe("sendA2ATask · response outcomes", () => {
  it("returns the task on a successful result", async () => {
    stubFetch(() => ({ body: { result: completedTask() } as A2ARpcResponse<A2ATask> }));
    const task = await sendA2ATask("https://agent.example", SAMPLE_PARAMS);
    expect(task.id).toBe("task-abc");
    expect(task.status.state).toBe("completed");
  });

  it("throws on a non-2xx HTTP response", async () => {
    stubFetch(() => ({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      body: {}
    }));
    await expect(
      sendA2ATask("https://agent.example", SAMPLE_PARAMS)
    ).rejects.toThrow(/503 Service Unavailable/);
  });

  it("throws when the JSON-RPC envelope carries an error", async () => {
    stubFetch(() => ({
      body: {
        jsonrpc: "2.0",
        id: "task-abc",
        error: { code: -32600, message: "Invalid Request" }
      } as A2ARpcResponse<A2ATask>
    }));
    await expect(
      sendA2ATask("https://agent.example", SAMPLE_PARAMS)
    ).rejects.toThrow(/-32600 Invalid Request/);
  });

  it("throws when a 2xx response has neither result nor error", async () => {
    stubFetch(() => ({ body: { jsonrpc: "2.0", id: "task-abc" } }));
    await expect(
      sendA2ATask("https://agent.example", SAMPLE_PARAMS)
    ).rejects.toThrow(/missing result/);
  });
});

describe("message + id helpers", () => {
  it("userMessage builds a user-role text part, optionally with a data part", () => {
    const plain = userMessage("hello");
    expect(plain.role).toBe("user");
    expect(plain.parts).toEqual([{ type: "text", text: "hello" }]);
    expect(typeof plain.timestamp).toBe("string");

    const withData = userMessage("hello", { a: 1 });
    expect(withData.parts).toHaveLength(2);
    expect(withData.parts[1]).toEqual({ type: "data", data: { a: 1 } });
  });

  it("agentMessage builds an agent-role message with the same part rules", () => {
    const msg = agentMessage("done", { pathway: "self-care" });
    expect(msg.role).toBe("agent");
    expect(msg.parts[0]).toEqual({ type: "text", text: "done" });
    expect(msg.parts[1]).toEqual({ type: "data", data: { pathway: "self-care" } });
  });

  it("newTaskId is prefixed and unique across calls", () => {
    const a = newTaskId("care-router");
    const b = newTaskId("care-router");
    expect(a.startsWith("care-router-")).toBe(true);
    expect(a).not.toBe(b);
    expect(newTaskId().startsWith("task-")).toBe(true);
  });

  it("nowIso returns a parseable ISO-8601 timestamp", () => {
    const iso = nowIso();
    expect(new Date(iso).toISOString()).toBe(iso);
  });
});
