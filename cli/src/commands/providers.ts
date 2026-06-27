import { callExperienceApi } from "../lib/client.js";
import { parseFlags } from "../lib/options.js";

type Provider = {
  npi: string;
  name: string;
  specialty: string;
  city: string;
  state: string;
  zip: string;
  menopauseCertified: boolean;
  telehealth: boolean;
  acceptingNewPatients: boolean;
  distanceMiles: number | null;
  credentialSource?: string;
};

type ProvidersResponse = {
  meta: { _source?: string };
  query: Record<string, unknown>;
  matchType: string;
  total: number;
  returned: number;
  providers: Provider[];
};

export async function runProviders(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const qs = new URLSearchParams();
  if (flags.zip) qs.set("zip", flags.zip);
  if (flags.menopause) qs.set("menopause", "true");
  if (flags.limit) qs.set("limit", flags.limit);
  if (flags.fallback) qs.set("fallback", "true");
  if (flags.insurance) qs.set("insurance", flags.insurance);
  if (flags.telehealth) qs.set("telehealth", "true");
  const query = qs.toString();
  const path = `/api/mulesoft/providers${query ? `?${query}` : ""}`;

  const data = await callExperienceApi<ProvidersResponse>({
    baseUrl: flags.baseUrl,
    path
  });

  if (flags.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(`source: ${data.meta?._source ?? "(unknown)"}\n`);
  process.stdout.write(`matchType: ${data.matchType}\n`);
  process.stdout.write(`returned: ${data.returned}/${data.total}\n`);
  for (const p of data.providers) {
    const flags2: string[] = [];
    if (p.menopauseCertified) flags2.push("MSCP");
    if (p.telehealth) flags2.push("telehealth");
    if (p.acceptingNewPatients) flags2.push("accepting");
    if (p.distanceMiles !== null && p.distanceMiles !== undefined) {
      flags2.push(`${p.distanceMiles.toFixed(1)}mi`);
    }
    process.stdout.write(
      `  - ${p.name} — ${p.specialty} — ${p.city}, ${p.state} ${p.zip} (${flags2.join(", ") || "—"})\n`
    );
  }
  return 0;
}
