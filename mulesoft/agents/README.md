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
| `generate-agent-assets.mjs` | Reads the snapshot, writes one asset folder per agent under `assets/<id>/` (agent card + `README.md`) and `assets-manifest.json`. No network. |
| `publish-agent-assets.sh` | Dry-run-by-default publisher. Validates every asset, prints the exact publish commands, and (only with explicit flags) probes creds or publishes via the Exchange Experience API (`type=agent`). |
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

2. **Asset-type path — VERIFIED.** The publisher uses the Exchange Experience API
   (`POST /exchange/api/v2/organizations/{org}/assets/{group}/{assetId}/{version}`)
   with `type=agent`, `classifier=a2a-card`, and the card as `files.json`. This was
   confirmed against the live org with a throwaway asset that came back
   `type: agent`, `status: published`, and appeared under a `?type=agent` search
   (then was deleted). The Maven-v2 jar PUT that published the spec assets yields
   `type=unknown` and is deliberately **not** used here. Delete endpoint if you
   ever need it: `DELETE /exchange/api/v2/assets/{group}/{assetId}/{version}`.

3. **Go live** (only after 1, and only when you've said go):
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
