# Scoping: what it takes to populate Anypoint Agent Visualizer

**TL;DR** — We published all 110 fabric agents to Exchange as `type=agent` assets.
That makes them **discoverable** in Exchange's Agents & Tools catalog, but the
**Agent Visualizer graph stays empty** because Visualizer is a *runtime-traffic
observability* view, not an asset browser. To draw a node, an agent's traffic must
flow through a deployed **Omni Gateway** that emits telemetry to Anypoint
Monitoring. The good news: our agents already expose native A2A cards, so we can
register them as **external A2A agents by URL** — **no rebuild into Mule apps** —
but we still have to stand up a gateway + agent network and route real traffic.

Sourced from docs.mulesoft.com (URLs inline). "Confirmed" = stated in docs;
"inferred" = strongly implied but not spelled out.

---

## The Agent Fabric flow (where Visualizer sits)

`Publish → Deploy → Enforce → Observe`

1. **Publish** — assets to Exchange. ✅ *Done — all 110 as `type=agent`.*
2. **Deploy** — agent network + gateway to a runtime (CloudHub 2.0 / Runtime Fabric).
3. **Enforce** — Omni Gateway in the request path; egress gateway **emits telemetry**.
4. **Observe** — Anypoint Monitoring collects it; **Visualizer renders it**.

Visualizer "watches live request flows and metrics such as latency, throughput,
and error rates" — confirmed a traffic view. Exchange registration is necessary
but **not sufficient**.

## Key finding: no rebuild required

Agent Network YAML supports **external A2A agents as first-class**, referenced by
URL — we don't have to reimplement the 110 as Mule apps. Registry entry declares
the A2A card (`supportedInterfaces[].url` = our endpoint, `protocolBinding:
JSONRPC`, `protocolVersion`), and `context.connections` binds the URL + auth:

```yaml
registry:
  agents:
    care-router-claude:
      metadata:
        interfaces:
          a2a:
            card:
              name: care-router-claude
              supportedInterfaces:
                - url: https://pause-health.ai/api/agents/care-router
                  protocolBinding: JSONRPC
                  protocolVersion: "1.0"
context:
  connections:
    care_router_claude:
      kind: a2a
      ref: { name: care-router-claude }
      url: https://pause-health.ai/api/agents/care-router
```

The docs' IT-investigation example uses **mock HTTP endpoints** referenced by URL
(exactly our situation).
Ref: docs.mulesoft.com/agent-network/latest/af-agent-network-yaml-reference ,
docs.mulesoft.com/agent-network/latest/af-example-it-investigation-broker

## Minimum viable path to one live node

1. Provision a runtime — **CloudHub 2.0 shared space** ("no setup required", lowest effort).
2. Deploy a **Managed Omni Gateway** (single ingress+egress) via Code Builder
   "Set Up Agent Network Gateways".
3. Create an **Agent Network project**; declare our A2A agents as external
   registry entries + connections (as above).
4. Publish + deploy the network so the gateway is in the request path.
5. **Drive traffic through the egress gateway** (via a broker or a client) — this
   emits the telemetry that populates Monitoring → Visualizer.

Refs: docs.mulesoft.com/agent-network/latest/af-get-started ,
docs.mulesoft.com/gateway/latest/gateway-managed-ingress-egress

## Effort estimate

| Component | Effort | Notes |
|---|---|---|
| CloudHub 2.0 shared space | Low | No setup; needs Anypoint runtime entitlement |
| Managed Omni Gateway (ingress+egress) | Low–Med | One deploy via Code Builder/CLI/Runtime Manager |
| Agent Network project + YAML for N agents | Med | Generate registry+connections from our cards (we already have the snapshot) |
| Traffic generator (broker or client) | Med | **Load-bearing** — a node only appears once called through the gateway |
| A2A protocol-version reconciliation | Med–High risk | MuleSoft is A2A **v1.0**; our cards are **v0.3**. Mismatch → `401` at runtime |
| Monitoring wiring | Low (inferred auto) | Part of the managed pipeline; not explicitly documented |

## Highest-risk / open items

1. **A2A version mismatch (v0.3 cards vs MuleSoft v1.0).** Declared `protocolVersion`
   must match the deployed agent's actual version or you get `401 Unauthorized`.
   There is a legacy `a2a_v03` key — needs verification against our cards. **Top risk.**
2. **Registration ≠ a node.** Inferred: an agent must receive gateway-routed
   traffic (not just be in the registry) to appear. So a traffic source is required,
   not optional.
3. **Subscription / licensing / cost is UNDOCUMENTED.** No Agent Fabric, Omni
   Gateway, Monitoring, or Visualizer page states a tier, add-on, or price. Agent
   Fabric is a newer paid capability — **confirm entitlement + cost with the MuleSoft
   account team before committing.** Single biggest unpriced variable.
4. **`.well-known/agent.json` is not a MuleSoft field.** The network points at the
   A2A endpoint `url` directly; our `.well-known` cards are the source of truth to
   transcribe from, not something MuleSoft auto-discovers.
5. **Redeploy lock-in.** Can't redeploy to a different target/gateway without first
   manually deleting the Runtime Manager app — plan topology up front.

## What "external platforms" (Bedrock/Copilot/Vertex) means

That's marketing-page wording — those names are **not** in the technical docs.
Non-A2A agents need an "A2A bridge" (Agentforce is the named example). **Our agents
already speak A2A**, so we register them directly, no bridge.

## Recommendation

If a live Visualizer graph is a real goal (vs. the Exchange catalog we already have):
do a **1-agent spike first** — one CloudHub 2.0 shared gateway + one external A2A
registry entry (`care-router-claude`) + a trivial client calling it through the
egress gateway — to (a) settle the v0.3↔v1.0 protocol question and (b) confirm a
node actually renders. That de-risks the two biggest unknowns cheaply before
scaling to 110. **Prerequisite:** confirm Agent Fabric entitlement/cost with MuleSoft.
