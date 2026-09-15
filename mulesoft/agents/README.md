# Pause fabric agents → Anypoint Exchange (for Agent Visualizer)

Anypoint **Agent Visualizer** shows an agent network graph built from data in
**Exchange** (agent/MCP assets) + **Anypoint Monitoring** (live traffic) +
**API Manager**. Ours is empty because the 110 Pause fabric agents live only as
mocked in-repo A2A endpoints and a mocked registry (`frontend/lib/agent-fabric.ts`)
— **none are registered in Exchange**.

This directory is the tooling that prepares one Exchange **"Agents"** asset per
fabric agent (A2A v0.3 card, classifier `a2a-card`) and publishes them. It is
**dry-run by default — nothing hits the live org** until you explicitly go live.

## What's here

| File | Purpose |
|------|---------|
| `agents-snapshot.json` | Deterministic, offline snapshot of the live registry (all 110 agents + their policies). Source of truth for generation. |
| `generate-agent-assets.mjs` | Reads the snapshot, writes one asset folder per agent under `assets/<id>/` (agent card + `pom.xml` + `README.md`) and `assets-manifest.json`. No network. |
| `publish-agent-assets.sh` | Dry-run-by-default publisher. Validates every asset, prints the exact publish commands, and (only with explicit flags) probes creds or publishes. |
| `assets/<id>/` | 110 generated asset folders. **Fully generated** — do not hand-edit; change the generator and re-run. |
| `assets-manifest.json` | Machine-readable index the publisher loops over. |

## Regenerate

```bash
# 1. (only if the registry changed) refresh the snapshot from lib/agent-fabric.ts.
#    A throwaway vitest test dumps listAgents()+getPoliciesForAgent() to JSON:
cd frontend
cat > lib/__snapshot_agents.gen.test.ts <<'TS'
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { listAgents, getPoliciesForAgent } from "./agent-fabric";
describe("snapshot agent registry", () => {
  it("writes agents-snapshot.json", () => {
    const agents = listAgents().map((a) => ({
      ...a,
      policyDetails: getPoliciesForAgent(a.id).map((p) => ({
        id: p.id, name: p.name, enforcement: p.enforcement, status: p.status
      }))
    }));
    writeFileSync(
      resolve(__dirname, "../../mulesoft/agents/agents-snapshot.json"),
      JSON.stringify({ generatedFrom: "frontend/lib/agent-fabric.ts listAgents()",
        agentCount: agents.length, agents }, null, 2) + "\n"
    );
  });
});
TS
npx vitest run lib/__snapshot_agents.gen.test.ts && rm -f lib/__snapshot_agents.gen.test.ts
cd ..

# 2. generate the asset folders (no network)
node mulesoft/agents/generate-agent-assets.mjs

# 3. dry-run the publish plan (asserts 0 network calls)
bash mulesoft/agents/publish-agent-assets.sh
```

## Go-live checklist (do NOT skip)

Publishing to Exchange is **hard to reverse — Exchange tombstones a version
permanently**, so a published `1.0.0` can't be re-used even after deletion.

1. **Confirm credentials are current.** The publisher reads the
   `anypoint-exchange-v2` server from `~/.m2/settings.xml`
   (`<client_id>~?~<client_secret>` in the password field). These are the
   `pause-prototype-cloudhub` Connected App creds and **may need rotation**
   (they were exposed previously — see `docs/MULESOFT_RUNBOOK.md` and memory).
   Verify with the read-only probe:
   ```bash
   bash mulesoft/agents/publish-agent-assets.sh --probe
   ```
   This fetches a token and makes ONE read-only GET. If the token fetch fails,
   the creds are expired — rotate them in the Connected App before going further.

2. **Confirm the asset-type path.** The Maven-v2 PUT path this script uses
   publishes the card as a Maven artifact under the business group. Exchange's
   native **"Agents"** type (what Visualizer reads) is documented via the
   Exchange UI *Publish new asset* dialog and the Exchange Experience API with
   the `a2a-card` classifier. Before a bulk live run, publish **one** asset and
   check in the Exchange UI that it is typed **Agent** (not generic Custom). If
   Maven-v2 doesn't tag it as an agent, switch the publish step to the Exchange
   asset-upload endpoint with `type=agent` / classifier `a2a-card` (still curl +
   Bearer token; the script's `--live` loop is the place to change).

3. **Go live** (only after 1 + 2, and only when you've said go):
   ```bash
   bash mulesoft/agents/publish-agent-assets.sh --live CONFIRM=yes
   ```

4. **Verify.** Reload Agent Visualizer
   (`anypoint.mulesoft.com/visualizer/agentvisualizer/`) and confirm the Pause
   agents appear; capture the count. Live traffic edges also require the agents
   to route through Omni/Flex Gateway with Monitoring — asset registration alone
   populates the inventory, not the live-volume edges.

## Guardrails

- **Dry-run is the default.** `--probe` is read-only. Writes require BOTH
  `--live` and `CONFIRM=yes`.
- **No secrets are committed.** Credentials stay in `~/.m2/settings.xml`; the
  script never echoes them.
- These are **prototype agent cards** — synthetic data, no real PHI. PHI posture
  per agent is recorded in each `assets/<id>/README.md`.
- **Re-publishing** the same version conflicts (tombstoning). Bump `ASSET_VERSION`
  in `generate-agent-assets.mjs` and regenerate before any second live run.
