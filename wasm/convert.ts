/**
 * report@v1 -> Allure2 results mapping for the WASM reporter.
 *
 * `convert()` returns files with serialized string `contents`, ready to hand
 * to the host's `emit-file`. UUIDs are deterministic (hash of run_id +
 * counter): the component build disables `wasi:random`, so
 * `crypto.randomUUID()` is unavailable.
 */

import type { ReportV1 } from "@perfscale/library-sdk";

const RESULT_SUFFIX = "-result.json";
const ATTACHMENT_SUFFIX = "-attachment.json";

export interface ConvertOptions {
  /** Suite name override (wins over run labels). */
  name?: string;
  /** Fallback suite name when no label/override applies. */
  fallbackName?: string;
}

export interface OutputFile {
  name: string;
  contents: string;
}

// ---------------------------------------------------------------------------
// Deterministic UUIDs (wasi:random is not provided to WASM guests)
// ---------------------------------------------------------------------------

let uuidCounter = 0;

/** FNV-1a 64-bit, hex. */
function fnv1a(input: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i) & 0xff);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

/** Deterministic RFC-4122-shaped UUID derived from `seed` + a counter. */
export function uuid(seed: string): string {
  const n = uuidCounter++;
  const hex = fnv1a(`${seed}:${n}:a`) + fnv1a(`${seed}:${n}:b`);
  const chars = hex.split("");
  chars[12] = "4"; // version 4
  chars[16] = ((parseInt(chars[16], 16) & 0x3) | 0x8).toString(16); // variant
  const h = chars.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------

function ms(seconds: number): number {
  return Math.round(seconds * 1000);
}

function isValidReport(report: unknown): report is ReportV1 {
  const r = report as ReportV1 | null;
  return (
    !!r &&
    typeof r === "object" &&
    r.schemaVersion === "report@v1" &&
    !!r.run &&
    typeof r.run === "object"
  );
}

function stringLabel(
  labels: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const v = labels?.[key];
  return typeof v === "string" && v ? v : undefined;
}

/** Suite name: config override > run.labels.suite > run.labels.service > fallback. */
function suiteName(report: ReportV1, opts: ConvertOptions): string {
  const labels = report.run.labels ?? {};
  return (
    opts.name ||
    stringLabel(labels, "suite") ||
    stringLabel(labels, "service") ||
    opts.fallbackName ||
    "perfscale run"
  );
}

interface AllureLabel {
  name: string;
  value: string;
}

function allureLabels(report: ReportV1, suite: string): AllureLabel[] {
  const labels: AllureLabel[] = [
    { name: "suite", value: suite },
    { name: "framework", value: "perfscale" },
  ];
  for (const [key, value] of Object.entries(report.run.labels ?? {})) {
    if (value == null) continue;
    const label = { name: String(key), value: String(value) };
    if (!labels.some((l) => l.name === label.name && l.value === label.value)) {
      labels.push(label);
    }
  }
  return labels;
}

/**
 * Convert a parsed report@v1 document into a list of output files with
 * serialized contents. Deterministic for a given report (UUIDs are derived
 * from `run_id`).
 */
export function convert(report: ReportV1, opts: ConvertOptions = {}): OutputFile[] {
  if (!isValidReport(report)) {
    throw new Error(
      'not a report@v1 document: expected top-level "schemaVersion": "report@v1" and "run"',
    );
  }
  uuidCounter = 0;
  const seed = report.run.run_id;

  const files: OutputFile[] = [];
  const suite = suiteName(report, opts);
  const labels = allureLabels(report, suite);
  const startedAtMs = Date.parse(report.run.started_at);
  const startedOk = Number.isFinite(startedAtMs);

  const push = (name: string, value: unknown, raw = false) => {
    files.push({
      name,
      contents: raw ? String(value) : JSON.stringify(value, null, 2) + "\n",
    });
  };

  // --- one test case per perfscale step --------------------------------
  for (const step of report.steps ?? []) {
    const min = ms(step.duration?.min ?? 0);
    const max = ms(step.duration?.max ?? min);
    const start = startedOk ? startedAtMs + min : 0;
    const stop = (startedOk ? startedAtMs : 0) + Math.max(max, min);

    const failed = step.failed ?? 0;
    const count = step.count ?? 0;
    const status = failed > 0 ? "failed" : "passed";

    const statsAttachment = {
      name: "perfscale step stats",
      source: `${uuid(seed)}${ATTACHMENT_SUFFIX}`,
      type: "application/json",
    };
    const stats = {
      action: step.action,
      count,
      failed,
      rate_per_s: step.rate,
      duration_s: step.duration,
    };

    const testCase: Record<string, unknown> = {
      uuid: uuid(seed),
      historyId: `${suite}:${step.name}`,
      name: step.name,
      fullName: `${suite} / ${step.name}`,
      status,
      statusDetails:
        failed > 0
          ? { message: `${failed}/${count} invocations failed` }
          : undefined,
      stage: "finished",
      start,
      stop,
      labels: [...labels, { name: "tag", value: step.action }],
      links: [],
      parameters: [],
      attachments: [statsAttachment],
      steps: [],
    };
    if (testCase.statusDetails === undefined) delete testCase.statusDetails;

    push(`${testCase.uuid}${RESULT_SUFFIX}`, testCase);
    push(statsAttachment.source, stats);
  }

  // --- one test case per threshold verdict ------------------------------
  for (const verdict of report.verdicts ?? []) {
    const name = `threshold: ${verdict.threshold} ${verdict.expression}`;
    const testCase: Record<string, unknown> = {
      uuid: uuid(seed),
      historyId: `${suite}:${name}`,
      name,
      fullName: `${suite} / ${name}`,
      // SLO breach is not a test bug -> "broken" rather than "failed".
      status: verdict.pass ? "passed" : "broken",
      statusDetails: verdict.pass
        ? undefined
        : {
            message: `observed ${verdict.observed} violates ${verdict.expression}`,
            trace: `threshold "${verdict.threshold}" expression "${verdict.expression}" observed ${verdict.observed}`,
          },
      stage: "finished",
      start: startedOk ? startedAtMs : 0,
      stop: startedOk ? startedAtMs + ms(report.run.duration_s ?? 0) : 0,
      labels: [...labels, { name: "tag", value: "threshold" }],
      links: [],
      parameters: [
        { name: "observed", value: String(verdict.observed) },
        { name: "expression", value: verdict.expression },
      ],
      attachments: [],
      steps: [],
    };
    if (testCase.statusDetails === undefined) delete testCase.statusDetails;
    push(`${testCase.uuid}${RESULT_SUFFIX}`, testCase);
  }

  // --- environment.properties -------------------------------------------
  const env: Record<string, unknown> = {
    perfscale_version: report.run.perfscale_version,
    engine: report.run.engine,
    run_id: report.run.run_id,
    duration_s: report.run.duration_s,
  };
  if (report.run.vus != null) env.vus = report.run.vus;
  const envText =
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n";
  push("environment.properties", envText, true);

  return files;
}
