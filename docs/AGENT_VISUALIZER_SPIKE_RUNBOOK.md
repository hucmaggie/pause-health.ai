# Runbook: light up one node in Anypoint Agent Visualizer (1-agent spike)

Executable companion to the scoping doc
[`mulesoft/agents/VISUALIZER_RUNTIME_SCOPE.md`](../mulesoft/agents/VISUALIZER_RUNTIME_SCOPE.md).
That doc explains **why** the Visualizer graph is empty (it renders live Omni
Gateway telemetry, not Exchange assets — and all 110 fabric agents are registered
in Exchange as `type=agent` but none run behind a gateway). This doc is the
**how**: a concrete, de-risking spike that gets ONE agent (`care-router-claude`)
to render a node, reusing the runtime infra we already have.

**Nothing here has been executed.** It is a plan you run when you decide to spend
the infra time + money. No CloudHub deploy, no gateway, no spend has happened.

---

## 0. Prerequisite GATE — do this before anything else

**Confirm Agent Fabric / Omni Gateway / Anypoint Monitoring entitlement + cost
with the MuleSoft account team.** This is the single biggest unpriced unknown
(scope doc risk #3): no public docs page states a tier/add-on/price, and Agent
Fabric is a newer paid capability. **Do not start section 2 until this is
answered** — the spike is pointless if the org isn't entitled to the gateway or
the cost is prohibitive.

Deliverable of this gate: a yes/no on entitlement + a rough monthly cost for one
shared-space gateway. If no → stop; the Exchange catalog (110 agents as
`type=agent`) remains the demonstrable result and the honest site framing stands.

## 1. Reuse inventory — what we already have (don't rebuild)

The MuleSoft runtime foundation from Phases 1–3 (see
[[project-mulesoft-state]] / `docs/MULESOFT_RUNBOOK.md`) means the spike is
mostly *wiring*, not greenfield:

| Asset | Value | Use in the spike |
|---|---|---|
| Business group id | `56707cc3-a0e3-4318-b110-78126aace370` | all Anypoint API/CLI calls |
| Connected App | `pause-prototype-cloudhub` (id `6fc9564a3aab4c0c8154e5fed60b606c`) | gateway/network deploy auth; has Deploy/Runtime-Manager scopes |
| `~/.m2/settings.xml` | `anypoint-exchange-v2` server (`<clientId>~?~<clientSecret>`) | already points at the rotated Connected App |
| Live CloudHub 2.0 worker | `pause-mulesoft-health-v1` 1.0.5, Cloudhub-US-West-1, Sandbox | proves we have runtime entitlement + a working deploy pipeline |
| Omni Gateway experience | Flex Gateway (instance 20955827) via `mulesoft/flex-gateway/docker-compose.yml` | we've stood up + policied an Omni Gateway before |
| The agent to register | `care-router-claude` → `https://pause-health.ai/api/agents/care-router` (A2A JSON-RPC `tasks/send`), card at `/.well-known/agent.json` | the one external A2A registry entry |
| Agent snapshot | `mulesoft/agents/agents-snapshot.json` (+ generator) | source to transcribe registry/connections YAML from |

Key finding from the scope doc: **no rebuild into Mule apps.** Agent Network YAML
supports external A2A agents by URL; we register `care-router-claude` pointing at
its live Vercel endpoint.

## 2. The spike — one agent, one node

> Run from your terminal (Anypoint CLI / Code Builder). `JAVA_HOME` → Zulu 17 for
> any Maven step (Java 25 is rejected by the mule plugins — MULESOFT_RUNBOOK gotcha).

1. **Provision the runtime.** Use the **CloudHub 2.0 shared space** ("no setup
   required", lowest effort). Confirm the Sandbox env under the Pause Health BG is
   available (the 1.0.5 worker already lives there, so this should be a no-op).

2. **Deploy a Managed Omni Gateway (single ingress+egress).** Via Code Builder's
   "Set Up Agent Network Gateways" (or Runtime Manager). Authenticate with the
   `pause-prototype-cloudhub` Connected App. Refs:
   docs.mulesoft.com/gateway/latest/gateway-managed-ingress-egress ,
   docs.mulesoft.com/agent-network/latest/af-get-started

3. **Create an Agent Network project** and declare `care-router-claude` as an
   external A2A registry entry + connection, transcribed from its
   `.well-known/agent.json`. Starting YAML (from the scope doc):
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
                     protocolVersion: "1.0"   # <-- see step 4, protocol reconciliation
   context:
     connections:
       care_router_claude:
         kind: a2a
         ref: { name: care-router-claude }
         url: https://pause-health.ai/api/agents/care-router
   ```
   Ref: docs.mulesoft.com/agent-network/latest/af-agent-network-yaml-reference and
   the af-example-it-investigation-broker (which uses mock HTTP endpoints by URL —
   exactly our shape).

4. **RESOLVE THE PROTOCOL MISMATCH (top risk).** MuleSoft Agent Network is A2A
   **v1.0**; our cards are **A2A v0.3**. A declared `protocolVersion` that doesn't
   match the endpoint's actual version yields a runtime **401**. Try, in order:
   (a) the legacy `a2a_v03` interface key if the deployed CLI supports it; failing
   that (b) add a tiny **v1.0-shaped shim** in front of the Care Router (a Vercel
   route that speaks the v1.0 envelope and proxies to the existing v0.3
   `tasks/send`) and point the registry `url` at the shim. Decide here before
   scaling — this is the load-bearing unknown for all 110.

5. **Publish + deploy the network** so the Omni Gateway is in the request path.

6. **Drive traffic through the egress gateway (load-bearing).** A node only
   renders once it is *called through the gateway* — registration alone draws
   nothing. Run a trivial client that sends N `tasks/send` calls at the
   gateway-fronted URL (a small loop, or a minimal broker per the IT-investigation
   example). Use a benign Care Router intake (with the mandatory red-flag screen)
   so the calls succeed and emit clean spans.

7. **Verify in Visualizer.** Anypoint → Monitoring / Agent Visualizer → confirm a
   `care-router-claude` node (and the client→agent edge) appears with
   latency/throughput. Capture a screenshot for the record. **This is the spike's
   success criterion.**

## 3. Decision checkpoint

Only proceed past the spike if BOTH are true:
- Entitlement confirmed + cost acceptable (section 0), AND
- One node actually rendered (section 2 step 7) with the protocol question settled.

If either fails → stop and keep the Exchange catalog as the deliverable; update the
scope doc + the honest site framing to say runtime-observability is a costed future
phase.

## 4. Scale to all 110 (only after the spike renders)

- Generate `registry.agents` + `context.connections` for every agent from
  `mulesoft/agents/agents-snapshot.json` (extend the existing generator in
  `mulesoft/agents/` — we already emit one A2A card per agent, so this is a second
  emitter, not new data).
- Apply the same protocol resolution (legacy key or shim) uniformly.
- Mind **redeploy lock-in** (scope doc risk #5): you can't retarget a network to a
  different gateway without deleting the Runtime Manager app first — settle
  topology (one gateway, all agents behind it) before the bulk deploy.
- Drive representative traffic per agent (or via a broker orchestration) so each
  node renders.

## 5. Honest framing / guardrails

- The fabric agents remain **mocked Vercel/Next.js endpoints** — the spike puts a
  real gateway *in front of* one of them and drives real traffic; it does not make
  the agents themselves production clinical services. Keep the synthetic/advisory
  labels.
- Cost is real and recurring (gateway + monitoring). The spike is deliberately
  1-agent to answer entitlement + protocol cheaply before any bulk spend.
- No secrets in this doc or the repo; the Connected App secret stays in
  `~/.m2/settings.xml` / Anypoint.

## Open questions to close during the spike
1. Does the deployed Anypoint CLI/Code Builder accept the `a2a_v03` legacy
   interface key, or is the v1.0 shim required? (Determines the shim work for 110.)
2. Is Monitoring auto-wired by the managed gateway, or a separate enablement step?
   (Scope doc infers auto; confirm.)
3. What is the actual monthly cost of one shared-space Omni Gateway + Monitoring?
