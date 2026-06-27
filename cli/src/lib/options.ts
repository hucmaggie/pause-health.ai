/**
 * Shared option-parsing helpers.
 *
 * Hand-rolled argv parsing — see cli.ts for why we avoid commander/yargs
 * for a four-endpoint shim. The parser is intentionally minimal:
 *   - boolean flags: --json, --menopause, --fallback, --telehealth, --help
 *   - value flags: --zip N, --limit N, --insurance PLAN, --base-url URL
 *   - positional args: <patient-id> for timeline/intake
 *   - unknown flags throw with a usage hint
 */

export type ParsedFlags = {
  json: boolean;
  baseUrl: string;
  menopause: boolean;
  fallback: boolean;
  telehealth: boolean;
  zip?: string;
  limit?: string;
  insurance?: string;
  positional: string[];
};

const BOOLEAN_FLAGS = new Set(["json", "menopause", "fallback", "telehealth"]);
const VALUE_FLAGS = new Set(["base-url", "zip", "limit", "insurance"]);

function valueFlagKey(flag: string): keyof ParsedFlags | null {
  if (flag === "base-url") return "baseUrl";
  if (flag === "zip" || flag === "limit" || flag === "insurance") return flag;
  return null;
}

export function defaultBaseUrl(): string {
  return process.env.PAUSE_BASE_URL?.trim() || "https://pause-health.ai";
}

export function parseFlags(argv: string[]): ParsedFlags {
  const out: ParsedFlags = {
    json: false,
    baseUrl: defaultBaseUrl(),
    menopause: false,
    fallback: false,
    telehealth: false,
    positional: []
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      out.positional.push(token);
      continue;
    }
    const flag = token.slice(2);
    if (BOOLEAN_FLAGS.has(flag)) {
      (out as unknown as Record<string, boolean>)[flag] = true;
      continue;
    }
    if (VALUE_FLAGS.has(flag)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`flag --${flag} requires a value`);
      }
      const key = valueFlagKey(flag);
      if (!key) {
        throw new Error(`internal: unmapped value flag --${flag}`);
      }
      (out as unknown as Record<string, string>)[key] = next;
      i++;
      continue;
    }
    throw new Error(`unknown flag: ${token}`);
  }
  return out;
}
