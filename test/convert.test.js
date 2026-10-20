import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

import { convert, writeResults } from "../src/convert.js";

const fixturePath = new URL("../fixtures/sample-report.json", import.meta.url)
  .pathname;
const report = JSON.parse(readFileSync(fixturePath, "utf8"));

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("convert()", () => {
  const files = convert(report, { fallbackName: "sample-report" });
  const results = files.filter((f) => f.name.endsWith("-result.json"));
  const byName = (n) => files.find((f) => f.name === n);

  it("rejects non-report@v1 input", () => {
    assert.throws(() => convert({}), /report@v1/);
    assert.throws(() => convert({ schemaVersion: "report@v0", run: {} }), /report@v1/);
  });

  it("emits one result per step plus one per verdict", () => {
    assert.equal(results.length, report.steps.length + report.verdicts.length);
  });

  it("uses UUID file names for results and attachments", () => {
    for (const f of files) {
      if (f.name === "environment.properties") continue;
      const base = f.name.replace(/-(result|attachment)\.json$/, "");
      assert.match(base, UUID_RE, f.name);
    }
  });

  it("maps step status from failed count", () => {
    const homepage = results.find((f) => f.contents.name === "homepage");
    assert.ok(homepage, "homepage step present");
    assert.equal(homepage.contents.status, "passed");
    assert.equal(homepage.contents.stage, "finished");
  });

  it("marks steps with failures as failed with statusDetails", () => {
    const failing = structuredClone(report);
    failing.steps[0].failed = 3;
    const out = convert(failing, { fallbackName: "x" });
    const homepage = out.find(
      (f) => f.name.endsWith("-result.json") && f.contents.name === "homepage",
    );
    assert.equal(homepage.contents.status, "failed");
    assert.match(homepage.contents.statusDetails.message, /3\/\d+ invocations failed/);
  });

  it("maps verdicts to threshold test cases (passed / broken)", () => {
    const thresholdCases = results.filter((f) =>
      f.contents.name.startsWith("threshold: "),
    );
    assert.equal(thresholdCases.length, report.verdicts.length);
    assert.ok(thresholdCases.every((f) => f.contents.status === "passed"));

    const breached = structuredClone(report);
    breached.verdicts[0].pass = false;
    const out = convert(breached, { fallbackName: "x" });
    const broken = out.find(
      (f) => f.name.endsWith("-result.json") && f.contents.status === "broken",
    );
    assert.ok(broken, "breached threshold becomes broken");
    assert.match(broken.contents.statusDetails.message, /observed/);
  });

  it("uses the run label 'suite' as the suite name", () => {
    const homepage = results.find((f) => f.contents.name === "homepage");
    const suites = homepage.contents.labels.filter((l) => l.name === "suite");
    assert.deepEqual(suites, [{ name: "suite", value: "hello" }]);
  });

  it("--name overrides the suite, file name is the fallback", () => {
    const named = convert(report, { name: "override", fallbackName: "fb" });
    const suite = named
      .find((f) => f.name.endsWith("-result.json"))
      .contents.labels.find((l) => l.name === "suite");
    assert.equal(suite.value, "override");

    const unlabeled = structuredClone(report);
    delete unlabeled.run.labels;
    const fb = convert(unlabeled, { fallbackName: "my-report" });
    const fbSuite = fb
      .find((f) => f.name.endsWith("-result.json"))
      .contents.labels.find((l) => l.name === "suite");
    assert.equal(fbSuite.value, "my-report");
  });

  it("carries run labels through as allure labels", () => {
    const homepage = results.find((f) => f.contents.name === "homepage");
    const env = homepage.contents.labels.find((l) => l.name === "env");
    assert.equal(env.value, "ci");
  });

  it("attaches step stats as a JSON attachment", () => {
    const homepage = results.find((f) => f.contents.name === "homepage");
    assert.equal(homepage.contents.attachments.length, 1);
    const att = homepage.contents.attachments[0];
    assert.equal(att.type, "application/json");
    const stats = byName(att.source);
    assert.ok(stats, "attachment file emitted");
    const step = report.steps.find((s) => s.name === "homepage");
    assert.equal(stats.contents.count, step.count);
    assert.equal(stats.contents.duration_s.p95, step.duration.p95);
  });

  it("emits start/stop in epoch milliseconds", () => {
    const t0 = Date.parse(report.run.started_at);
    for (const f of results) {
      assert.ok(f.contents.start >= t0, `${f.contents.name} start`);
      assert.ok(f.contents.stop >= f.contents.start, `${f.contents.name} stop`);
      assert.ok(Number.isInteger(f.contents.start));
      assert.ok(Number.isInteger(f.contents.stop));
    }
  });

  it("writes environment.properties with run identity", () => {
    const env = byName("environment.properties");
    assert.ok(env);
    assert.match(env.contents, /perfscale_version=.+/);
    assert.match(env.contents, /engine=native/);
    assert.match(env.contents, new RegExp(`run_id=${report.run.run_id}`));
    assert.match(env.contents, /duration_s=.+/);
    assert.match(env.contents, /vus=2/);
  });
});

describe("writeResults()", () => {
  it("writes a loadable allure-results directory", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "allure2-"));
    try {
      const written = writeResults(report, dir, { fallbackName: "sample" });
      const onDisk = readdirSync(dir);
      assert.equal(written.length, onDisk.length);
      for (const f of onDisk.filter((n) => n.endsWith(".json"))) {
        JSON.parse(readFileSync(path.join(dir, f), "utf8"));
      }
      assert.ok(onDisk.includes("environment.properties"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cli", () => {
  it("converts a file argument", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "allure2-cli-"));
    try {
      const out = execFileSync(
        process.execPath,
        [
          new URL("../src/cli.js", import.meta.url).pathname,
          fixturePath,
          "-o",
          dir,
        ],
        { encoding: "utf8" },
      );
      assert.match(out, /allure serve/);
      assert.ok(readdirSync(dir).some((n) => n.endsWith("-result.json")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads the report from stdin", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "allure2-stdin-"));
    try {
      const cli = new URL("../src/cli.js", import.meta.url).pathname;
      execFileSync(process.execPath, [cli, "-", "-o", dir], {
        input: readFileSync(fixturePath),
      });
      assert.ok(readdirSync(dir).includes("environment.properties"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
