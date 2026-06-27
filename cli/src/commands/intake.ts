import { callExperienceApi } from "../lib/client.js";
import { parseFlags } from "../lib/options.js";

type IntakeResponse = {
  meta: { _source?: string };
  intake: {
    patientId: string;
    preferredName?: string;
    primarySymptom?: string;
    ageBand?: string;
    vasomotorScore?: number;
    sleepScore?: number;
    moodScore?: number;
  };
};

export async function runIntake(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  if (flags.positional.length === 0) {
    throw new Error(
      "intake: missing <patient-id>. Example: pause intake pause-demo-patient-001"
    );
  }
  if (flags.positional.length > 1) {
    throw new Error(
      `intake: too many positional args (${flags.positional.join(" ")}). Expected one <patient-id>.`
    );
  }
  const patientId = flags.positional[0];
  const data = await callExperienceApi<IntakeResponse>({
    baseUrl: flags.baseUrl,
    path: `/api/mulesoft/patient/${encodeURIComponent(patientId)}/intake`
  });
  if (flags.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return 0;
  }
  const i = data.intake;
  process.stdout.write(`patient: ${i.patientId}\n`);
  process.stdout.write(`source: ${data.meta?._source ?? "(unknown)"}\n`);
  if (i.preferredName) process.stdout.write(`name: ${i.preferredName}\n`);
  if (i.ageBand) process.stdout.write(`age band: ${i.ageBand}\n`);
  if (i.primarySymptom) {
    process.stdout.write(`primary symptom: ${i.primarySymptom}\n`);
  }
  const scores: string[] = [];
  if (i.vasomotorScore !== undefined) scores.push(`vasomotor=${i.vasomotorScore}`);
  if (i.sleepScore !== undefined) scores.push(`sleep=${i.sleepScore}`);
  if (i.moodScore !== undefined) scores.push(`mood=${i.moodScore}`);
  if (scores.length > 0) {
    process.stdout.write(`scores: ${scores.join(", ")}\n`);
  }
  return 0;
}
