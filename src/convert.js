/**
 * report@v1 -> Allure2 results converter.
 *
 * Pure functions + one file-writing entry point; no runtime dependencies.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const RESULT_SUFFIX = "-result.json";
const ATTACHMENT_SUFFIX = "-attachment.json";

/** Allure2 result file names must be UUIDs. */
export function uuid() {
  return crypto.randomUUID();
}

function ms(seconds) {
  return Math.round(seconds * 1000);
}

function isValidReport(report) {
  return (
    report &&
    typeof report === "object" &&
    report.schemaVersion === "report@v1" &&
    report.run &&
    typeof report.run === "object"
  );
}

/**
 * Suite name: --name flag > run.labels.suite > run.labels.service > file name.
 */
function suiteName(report, opts) {
  const labels = report.run.labels ?? {};
  return (
    opts.name ||
    stringLabel(labels, "suite") ||
    stringLabel(labels, "service") ||
    opts.fallbackName ||
    "perfscale run"
  );
}

function stringLabel(labels, key) {
  const v = labels[key];
  return typeof v === "string" && v ? v : undefined;
}

function allureLabels(report, suite) {
  const labels = [
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
 * Convert a parsed report@v1 document into an in-memory list of files:
 * `[{ name, contents }]`. The caller decides where to write them.
 */
export function convert(report, opts = {}) {
  if (!isValidReport(report)) {
    throw new Error(
      'not a report@v1 document: expected top-level "schemaVersion": "report@v1" and "run"',
    );
  }

  const files = [];
  const suite = suiteName(report, opts);
  const labels = allureLabels(report, suite);
  const startedAtMs = Date.parse(report.run.started_at);
  const startedOk = Number.isFinite(startedAtMs);

  // --- one test case per perfscale step -------------------------------
  for (const step of report.steps ?? []) {
    // Timings: spread the step's invocations across its observed
    // min..max duration window, anchored at the run start. Allure needs
    // epoch ms; without a valid started_at we fall back to 0-based.
    const min = ms(step.duration?.min ?? 0);
    const max = ms(step.duration?.max ?? min);
    const start = startedOk ? startedAtMs + min : 0;
    const stop = (startedOk ? startedAtMs : 0) + Math.max(max, min);

    const failed = step.failed ?? 0;
    const count = step.count ?? 0;
    const status = failed > 0 ? "failed" : "passed";

    const statsAttachment = {
      name: "perfscale step stats",
      source: `${uuid()}${ATTACHMENT_SUFFIX}`,
      type: "application/json",
    };
    const stats = {
      action: step.action,
      count,
      failed,
      rate_per_s: step.rate,
      duration_s: step.duration,
    };

    const testCase = {
      uuid: uuid(),
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

    files.push(
      { name: `${testCase.uuid}${RESULT_SUFFIX}`, contents: testCase },
      { name: statsAttachment.source, contents: stats },
    );
  }

  // --- one test case per threshold verdict -----------------------------
  for (const verdict of report.verdicts ?? []) {
    const name = `threshold: ${verdict.threshold} ${verdict.expression}`;
    const testCase = {
      uuid: uuid(),
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
    files.push({ name: `${testCase.uuid}${RESULT_SUFFIX}`, contents: testCase });
  }

  // --- environment.properties ------------------------------------------
  const env = {
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
  files.push({ name: "environment.properties", contents: envText, raw: true });

  return files;
}

/** Write converted files into `outDir`; returns the list of written paths. */
export function writeResults(report, outDir, opts = {}) {
  const files = convert(report, opts);
  mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const file of files) {
    const contents = file.raw
      ? file.contents
      : JSON.stringify(file.contents, null, 2) + "\n";
    const target = path.join(outDir, file.name);
    writeFileSync(target, contents);
    written.push(target);
  }
  return written;
}
