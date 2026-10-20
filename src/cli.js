#!/usr/bin/env node
/**
 * perfscale-report-allure2 — convert a perfscale `report@v1` JSON document
 * into an Allure2 results directory.
 *
 * Usage:
 *   perfscale-report-allure2 [report.json] [-o allure-results] [--name SUITE]
 *   perfscale run ... --report json:- | perfscale-report-allure2 - -o out
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { writeResults } from "./convert.js";

function usage(exitCode) {
  const text = `Usage: perfscale-report-allure2 [report.json|-] [options]

Convert a perfscale report@v1 JSON document into an Allure2 results directory.

Arguments:
  report.json        Path to a report@v1 JSON file, or "-" / omitted for stdin

Options:
  -o, --output DIR   Output directory for allure results (default: allure-results)
      --name NAME    Override the Allure suite name (default: run label
                     "suite"/"service", else the report file name)
  -h, --help         Show this help

Then view: allure serve <output dir>`;
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const opts = { output: "allure-results", name: undefined, input: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        usage(0);
        break;
      case "-o":
      case "--output":
        opts.output = argv[++i] ?? usage(1);
        break;
      case "--name":
        opts.name = argv[++i] ?? usage(1);
        break;
      default:
        if (arg.startsWith("--output=")) opts.output = arg.slice(9);
        else if (arg.startsWith("--name=")) opts.name = arg.slice(7);
        else if (opts.input === undefined) opts.input = arg;
        else {
          console.error(`unexpected argument: ${arg}`);
          usage(1);
        }
    }
  }
  return opts;
}

function readStdin() {
  return readFileSync(0, "utf8");
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  let json;
  let fallbackName = "perfscale run";
  if (!opts.input || opts.input === "-") {
    json = readStdin();
  } else {
    json = readFileSync(opts.input, "utf8");
    fallbackName = path.basename(opts.input).replace(/\.json$/i, "");
  }

  let report;
  try {
    report = JSON.parse(json);
  } catch (err) {
    console.error(`failed to parse report JSON: ${err.message}`);
    process.exit(1);
  }

  let written;
  try {
    written = writeResults(report, opts.output, {
      name: opts.name,
      fallbackName,
    });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const results = written.filter((f) => f.endsWith("-result.json")).length;
  console.log(
    `wrote ${results} allure result(s) to ${opts.output} — view with: allure serve ${opts.output}`,
  );
}

main();
