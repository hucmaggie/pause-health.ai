import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHAT_HANDOFF_ORIGIN,
  buildChatHandoffRequestBody,
  chatHandoffResultFromResponse,
  runChatCareRouterHandoff
} from "./chat-to-care-router-handoff";
import {
  findDemoPersona,
  personaToCareRouterIntake
} from "../lib/demo-cohort";

/**
 * Unit coverage for the /demo/intake "Complete intake → route to Care
 * Router" affordance. This repo tests components as node-env pure
 * functions (see recommended-providers.test.ts) rather than rendering
 * them, so we exercise the exact logic the button invokes:
 *   - the request body it POSTs (the selected persona's deterministic
 *     `personaToCareRouterIntake` intake + personaId + the chat origin),
 *   - that runChatCareRouterHandoff POSTs it to the server handoff route,
 *   - and that the returned decision is lifted into a render-ready shape.
 */

const anika = findDemoPersona("anika-patel")!;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildChatHandoffRequestBody", () => {
  it("carries the selected persona's structured intake, id, and chat origin", () => {
    const body = buildChatHandoffRequestBody(anika);
    expect(body.intake).toEqual(personaToCareRouterIntake(anika));
    expect(body.personaId).toBe("anika-patel");
    expect(body.origin).toBe(CHAT_HANDOFF_ORIGIN);
    expect(body.origin).toBe("agentforce-chat");
  });
});

describe("chatHandoffResultFromResponse", () => {
  it("lifts pathway, acuity, provenance, and sources from the decision", () => {
    const result = chatHandoffResultFromResponse({
      meta: {
        _data360IdentitySource: "real",
        _data360GroundingSource: "mock"
      },
      taskId: "intake-to-router-123",
      decision: {
        pathway: "gynecology",
        pathwayLabel: "Gynecology / menopause specialist",
        acuity: "routine",
        recommendedTargetResponse: "within 2 weeks",
        modelProvenance: {
          provider: "anthropic",
          model: "claude-sonnet-4-5-20250929",
          via: "claude-api"
        }
      }
    });
    expect(result.taskId).toBe("intake-to-router-123");
    expect(result.pathway).toBe("gynecology");
    expect(result.pathwayLabel).toBe("Gynecology / menopause specialist");
    expect(result.acuity).toBe("routine");
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4-5-20250929");
    expect(result.via).toBe("claude-api");
    expect(result.fallbackReason).toBeUndefined();
    expect(result.identitySource).toBe("real");
    expect(result.groundingSource).toBe("mock");
  });

  it("surfaces the scripted-fallback provenance + reason when present", () => {
    const result = chatHandoffResultFromResponse({
      meta: {},
      taskId: "t",
      decision: {
        pathway: "self-care-tracking",
        acuity: "self-care",
        modelProvenance: {
          provider: "pause-scripted",
          model: "pause-care-router-policy@1.0",
          via: "scripted-fallback"
        },
        fallbackReason: "ANTHROPIC_API_KEY not set; used scripted policy."
      }
    });
    expect(result.provider).toBe("pause-scripted");
    expect(result.via).toBe("scripted-fallback");
    expect(result.fallbackReason).toMatch(/ANTHROPIC_API_KEY/);
    // Label/target fall back to the pathway maps when the route omits them.
    expect(result.pathwayLabel.length).toBeGreaterThan(0);
  });
});

describe("runChatCareRouterHandoff", () => {
  it("POSTs the persona's intake to the handoff route and returns the decision", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/intake/route-to-care-router");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent).toEqual({
        intake: personaToCareRouterIntake(anika),
        personaId: "anika-patel",
        origin: "agentforce-chat"
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          meta: {
            _data360IdentitySource: "mock",
            _data360GroundingSource: "mock"
          },
          taskId: "intake-to-router-xyz",
          decision: {
            pathway: "gynecology",
            acuity: "routine",
            modelProvenance: {
              provider: "anthropic",
              model: "claude-sonnet-4-5-20250929",
              via: "claude-api"
            }
          }
        })
      } as unknown as Response;
    });

    const result = await runChatCareRouterHandoff(
      anika,
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.taskId).toBe("intake-to-router-xyz");
    expect(result.pathway).toBe("gynecology");
    expect(result.via).toBe("claude-api");
  });

  it("throws on a non-OK response so the UI can show an error", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runChatCareRouterHandoff(anika, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/502/);
  });
});
