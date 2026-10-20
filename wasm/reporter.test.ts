import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { testReport, type ReportV1 } from "@perfscale/library-sdk";
import reporter from "./reporter.ts";
import { convert, uuid } from "./convert.ts";

const fixturePath = new URL("../fixtures/sample-report.json", import.meta.url)
  .pathname;
const report = JSON.parse(readFileSync(fixturePath, "utf8")) as ReportV1;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("convert() (wasm port)", () => {
  const files = convert(report, { fallbackName: "sample-report" });
  const results = files.filter((f) => f.name.endsWith("-result.json"));
  const parsed = results.map((f) => JSON.parse(f.contents));

  it("rejects non-report@v1 input", () => {
    assert.throws(() => convert({} as ReportV1), /report@v1/);
  });

  it("emits one result per step plus one per verdict", () => {
    assert.equal(results.length, report.steps!.length + report.verdicts!.length);
  });

  it("uses deterministic, well-formed UUIDs", () => {
    for (const f of files) {
      if (f.name === "environment.properties") continue;
      const base = f.name.replace(/-(result|attachment)\.json$/, "");
      assert.match(base, UUID_RE, f.name);
    }
    const again = convert(report);
    assert.deepEqual(
      again.map((f) => f.name),
      files.map((f) => f.name),
      "same report -> same file names",
    );
  });

  it("serializes every file as a string", () => {
    for (const f of files) assert.equal(typeof f.contents, "string");
    for (const f of files.filter((f) => f.name.endsWith(".json"))) {
      JSON.parse(f.contents);
    }
  });

  it("maps step status and verdicts like the v1 converter", () => {
    const homepage = parsed.find((c) => c.name === "homepage");
    assert.equal(homepage.status, "passed");
    const thresholds = parsed.filter((c) => c.name.startsWith("threshold: "));
    assert.ok(thresholds.every((c) => c.status === "passed"));

    const breached = structuredClone(report);
    breached.verdicts![0].pass = false;
    const broken = convert(breached)
      .map((f) => (f.name.endsWith("-result.json") ? JSON.parse(f.contents) : null))
      .find((c) => c?.status === "broken");
    assert.ok(broken, "breached threshold becomes broken");
  });

  it("honors the suite name override", () => {
    const named = convert(report, { name: "override" })[0];
    const tc = JSON.parse(named.contents);
    assert.equal(
      tc.labels.find((l: { name: string }) => l.name === "suite").value,
      "override",
    );
  });

  it("writes environment.properties with run identity", () => {
    const env = files.find((f) => f.name === "environment.properties");
    assert.ok(env);
    assert.match(env.contents, /engine=native/);
    assert.match(env.contents, new RegExp(`run_id=${report.run.run_id}`));
  });
});

describe("uuid()", () => {
  it("never collides across a long sequence", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(uuid("seed"));
    assert.equal(seen.size, 1000);
  });
});

describe("reporter (testReport harness)", () => {
  it("emits the full allure2 results set via emit()", () => {
    const { summary, files } = testReport(reporter, report, { name: "ci" });
    assert.match(summary, /allure2 result\(s\)/);
    const names = Object.keys(files);
    assert.equal(
      names.filter((n) => n.endsWith("-result.json")).length,
      report.steps!.length + report.verdicts!.length,
    );
    assert.ok(names.includes("environment.properties"));
    const tc = JSON.parse(files[names.find((n) => n.endsWith("-result.json"))!]);
    assert.equal(
      tc.labels.find((l: { name: string }) => l.name === "suite").value,
      "ci",
    );
  });

  it("matches the v1 converter file-for-file (modulo uuids)", async () => {
    const UUID_G =
      /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g;
    const normalize = (files: { name: string; contents: string }[]) =>
      files
        .map((f) => ({
          suffix: f.name.replace(UUID_G, "<uuid>"),
          contents: f.contents.replace(UUID_G, "<uuid>"),
        }))
        .sort((a, b) => a.contents.localeCompare(b.contents));
    const v2 = normalize(convert(report, { fallbackName: "sample-report" }));
    const v1 = await import("../src/convert.js");
    const v1files = normalize(
      v1.convert(report, { fallbackName: "sample-report" }).map(
        (f: { name: string; raw?: boolean; contents: unknown }) => ({
          name: f.name,
          contents: f.raw
            ? String(f.contents)
            : JSON.stringify(f.contents, null, 2) + "\n",
        }),
      ),
    );
    assert.deepEqual(v2, v1files);
  });
});
