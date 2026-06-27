import { callExperienceApi } from "../lib/client.js";
import { parseFlags } from "../lib/options.js";

type TimelineResponse = {
  meta: { _source?: string };
  bundle: {
    entry?: Array<{
      resource?: { resourceType?: string; id?: string; status?: string };
    }>;
  };
};

export async function runTimeline(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  if (flags.positional.length === 0) {
    throw new Error(
      "timeline: missing <patient-id>. Example: pause timeline pause-demo-patient-001"
    );
  }
  if (flags.positional.length > 1) {
    throw new Error(
      `timeline: too many positional args (${flags.positional.join(" ")}). Expected one <patient-id>.`
    );
  }
  const patientId = flags.positional[0];
  const data = await callExperienceApi<TimelineResponse>({
    baseUrl: flags.baseUrl,
    path: `/api/mulesoft/patient/${encodeURIComponent(patientId)}/timeline`
  });
  if (flags.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return 0;
  }
  const entries = data.bundle?.entry ?? [];
  process.stdout.write(`patient: ${patientId}\n`);
  process.stdout.write(`source: ${data.meta?._source ?? "(unknown)"}\n`);
  process.stdout.write(`bundle entries: ${entries.length}\n`);
  for (const e of entries) {
    const r = e.resource;
    const stat = r?.status ? ` [${r.status}]` : "";
    process.stdout.write(`  - ${r?.resourceType ?? "?"} ${r?.id ?? ""}${stat}\n`);
  }
  return 0;
}
