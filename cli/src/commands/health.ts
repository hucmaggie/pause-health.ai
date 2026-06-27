import { callExperienceApi } from "../lib/client.js";
import { parseFlags } from "../lib/options.js";

type HealthResponse = {
  meta: { _source?: string; _bundleEntries?: number };
  bundle: { entry?: Array<{ resource?: { resourceType?: string; id?: string } }> };
};

export async function runHealth(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const data = await callExperienceApi<HealthResponse>({
    baseUrl: flags.baseUrl,
    path: "/api/mulesoft/health"
  });
  if (flags.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return 0;
  }
  const source = data.meta?._source ?? "(unknown)";
  const entries = data.bundle?.entry ?? [];
  process.stdout.write(`source: ${source}\n`);
  process.stdout.write(`bundle entries: ${entries.length}\n`);
  for (const e of entries) {
    const r = e.resource;
    process.stdout.write(`  - ${r?.resourceType ?? "?"} ${r?.id ?? ""}\n`);
  }
  return 0;
}
