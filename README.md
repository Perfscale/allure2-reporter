# @perfscale/allure2-reporter

A reference implementation of a custom reporter for
[perfscale](https://github.com/Perfscale/perfscale): it converts the
canonical `report@v1` JSON document into an
[Allure2](https://allurereport.org/) results directory.

perfscale can emit an end-of-run JSON report (`--report json:out.json`,
schema version `report@v1`) with run identity, per-step aggregates,
threshold verdicts, and self-describing metrics. This package shows how a
few dozen lines of plain JavaScript (zero runtime dependencies) turn that
document into a rich Allure report — use it as-is, or as a starting point
for your own reporter (Grafana, Datadog, HTML, whatever you need).

## Quickstart

```bash
# 1. Run a load test, writing the canonical JSON report
perfscale run -f test.yaml -c config.yaml --report json:report.json

# 2. Convert it to Allure2 results
npx @perfscale/allure2-reporter report.json -o allure-results

# 3. View the report (requires the Allure CLI)
allure serve allure-results
```

The reporter also reads from stdin, so you can pipe straight into it:

```bash
cat report.json | npx @perfscale/allure2-reporter - -o allure-results
```

### CLI

```
perfscale-report-allure2 [report.json|-] [options]

  -o, --output DIR   Output directory (default: allure-results)
      --name NAME    Override the Allure suite name
  -h, --help         Show help
```

## Mapping: `report@v1` → Allure2

| report@v1 | Allure2 |
|---|---|
| `steps[]` | One test case per step (`<uuid>-result.json`), `name = step.name` |
| `step.failed` | `status`: `passed` when `0`, `failed` otherwise (with `statusDetails.message = "<failed>/<count> invocations failed"`) |
| `run.started_at` + `step.duration.min/max` | `start`/`stop` in epoch ms: the step's observed duration window anchored at run start |
| `step.count`, `step.rate`, `step.duration` quantiles | JSON attachment "perfscale step stats" on the step's test case |
| `verdicts[]` | One test case per verdict, named `threshold: <metric> <expression>` — `passed` / `broken` on breach. A threshold breach is an SLO violation, not a test defect, hence `broken` rather than `failed`; the observed value goes into `statusDetails` and `parameters` |
| `run.labels` | Allure labels on every test case; `suite` (or `service`) label picks the suite name, overridable with `--name` |
| `run.perfscale_version`, `engine`, `run_id`, `duration_s`, `vus` | `environment.properties` (picked up by Allure automatically) |

The fixture under `fixtures/sample-report.json` is a real
`report@v1` document produced by `scripts/generate-fixture.sh` (requires a
perfscale binary and network access to httpbin.org).

## Writing your own reporter

The whole converter fits in one file ([`src/convert.js`](src/convert.js)).
A custom reporter is three steps:

1. **Get the JSON.** Run perfscale with `--report json:out.json` (or
   `json:-` for stdout). The document is self-describing: `schemaVersion`
   pins the contract (`report@v1`, additive-only evolution), durations are
   seconds on the wire.
2. **Parse it.** `JSON.parse` — that's it. The shape:
   `run` (identity, labels), `steps[]` (per-step aggregates with
   avg/p50/p90/p95/p99), `verdicts[]` (threshold pass/fail), `metrics[]`
   (self-describing metric families). See the schema in
   [crates/perfscale-core/src/report/v1.rs](https://github.com/Perfscale/perfscale/blob/main/crates/perfscale-core/src/report/v1.rs).
3. **Render it.** Walk the arrays and emit whatever your target system
   consumes. Here we write `<uuid>-result.json` test cases and
   `environment.properties` into an output directory — roughly 100 lines
   with no dependencies.

The `json` reporter is one of several built-in renderers; the background
and the canonical-report design are discussed in
[Perfscale/perfscale#9](https://github.com/Perfscale/perfscale/issues/9)
and the [perfscale docs](https://github.com/Perfscale/perfscale/tree/main/docs).

## Development

```bash
npm test                       # node:test suite over the real fixture
PERFSCALE=../path/to/perfscale ./scripts/generate-fixture.sh   # regenerate the fixture
```

## License

MIT OR Apache-2.0, at your option — same as perfscale.
