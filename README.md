# @perfscale/allure2-reporter

[![demo](https://github.com/Perfscale/allure2-reporter/actions/workflows/demo.yml/badge.svg)](https://github.com/Perfscale/allure2-reporter/actions/workflows/demo.yml)

A custom **WASM end-of-run reporter** for
[perfscale](https://github.com/Perfscale/perfscale), written in TypeScript:
at the end of a load run it renders the canonical `report@v1` document as an
[Allure2](https://allurereport.org/) results directory — one test case per
step, one per threshold verdict, plus `environment.properties`. The live
demo report from CI is on
[GitHub Pages](https://perfscale.github.io/allure2-reporter/).

The reporter is a WASM component implementing
[`perfscale:reporter@0.1.0`](https://github.com/Perfscale/perfscale/blob/main/wit/reporter/reporter.wit):
the engine hands it the report JSON and its config, and it writes output
files exclusively through the sandboxed `emit-file` host call — no
filesystem or network access.

## Quickstart

```bash
# 1. Grab the prebuilt reporter (committed to this repo — no build needed)
curl -fLO https://github.com/Perfscale/allure2-reporter/raw/main/dist/allure2-reporter.wasm
```

```yaml
# 2. Reference it from your perfscale config (config.yaml)
report:
  reporters:
    - use: wasm:./allure2-reporter.wasm
      with:
        output: ./allure-results     # where emit-file writes land
        config:
          name: my-suite             # optional Allure suite name override
```

```bash
# 3. Run and view
perfscale run -f test.yaml -c config.yaml
allure serve allure-results
```

## Write your own reporter in 3 steps

```ts
// 1. defineReporter — wasm/my-reporter.ts
import { defineReporter } from "@perfscale/library-sdk";

export default defineReporter({
  name: "my-reporter",
  onReport(report, config, emit) {
    // report: typed report@v1 (run, steps, verdicts, metrics)
    // config: the `with.config` block from YAML
    // emit:   the only output channel — writes into `with.output`
    emit("hello.txt", `run ${report.run.run_id}: ${report.steps?.length ?? 0} steps\n`);
    return "done"; // one-line summary the engine logs
  },
});
```

```bash
# 2. Build it to a WASM component (jco componentize under the hood)
npx perfscale-library-build --kind reporter my-reporter.ts -o my-reporter.wasm
```

```yaml
# 3. Use it
report:
  reporters:
    - use: wasm:./my-reporter.wasm
      with: { output: ./my-output }
```

The contract is [`wit/reporter/reporter.wit`](https://github.com/Perfscale/perfscale/blob/main/wit/reporter/reporter.wit)
(guest exports `on-report(report-json, config-json)`, host imports
`emit-file(name, contents)` with traversal-safe confinement); background and
design discussion in
[Perfscale/perfscale#9](https://github.com/Perfscale/perfscale/issues/9).
The TypeScript SDK (`defineReporter`, `ReportV1` types, `testReport` harness,
the build tool) lives in
[Perfscale/sdk-libraries](https://github.com/Perfscale/sdk-libraries/tree/main/ts).

### Building this reporter from source

The SDK is a normal npm devDependency
([`@perfscale/library-sdk`](https://www.npmjs.com/package/@perfscale/library-sdk)):

```bash
./scripts/build-wasm.sh   # npm install (in wasm/) + typecheck + componentize
```

Output: `dist/allure2-reporter.wasm` (committed to the repo, so consuming it
never requires a build). Requires perfscale ≥ v0.27.0 at runtime.

## Mapping: `report@v1` → Allure2

| report@v1 | Allure2 |
|---|---|
| `steps[]` | One test case per step (`<uuid>-result.json`), `name = step.name` |
| `step.failed` | `status`: `passed` when `0`, `failed` otherwise (with `statusDetails.message = "<failed>/<count> invocations failed"`) |
| `run.started_at` + `step.duration.min/max` | `start`/`stop` in epoch ms: the step's observed duration window anchored at run start |
| `step.count`, `step.rate`, `step.duration` quantiles | JSON attachment "perfscale step stats" on the step's test case |
| `verdicts[]` | One test case per verdict, named `threshold: <metric> <expression>` — `passed` / `broken` on breach. A threshold breach is an SLO violation, not a test defect, hence `broken` rather than `failed`; the observed value goes into `statusDetails` and `parameters` |
| `run.labels` | Allure labels on every test case; `suite` (or `service`) label picks the suite name, overridable via `config.name` |
| `run.perfscale_version`, `engine`, `run_id`, `duration_s`, `vus` | `environment.properties` (picked up by Allure automatically) |

UUIDs are deterministic (derived from `run_id`) because WASM guests get no
`wasi:random` — same report in, same file names out.

## Standalone converter (v1, no WASM)

Have a `report@v1` JSON file already (e.g. from `--report json:out.json`)
and no WASM reporter wired up? The plain-JS converter does the same mapping
as a CLI, zero runtime dependencies:

```bash
perfscale run -f test.yaml -c config.yaml --report json:report.json
npx @perfscale/allure2-reporter report.json -o allure-results
allure serve allure-results
```

It also reads stdin (`... --report json:- | perfscale-report-allure2 - -o out`).
See `perfscale-report-allure2 --help`. The WASM reporter's mapping
([`wasm/convert.ts`](wasm/convert.ts)) is a TypeScript port of
[`src/convert.js`](src/convert.js); a unit test asserts both produce
identical output modulo UUIDs.

## Repository layout

```
wasm/                 the WASM reporter (TypeScript, @perfscale/library-sdk)
  reporter.ts         defineReporter entry — emits via the host's emit-file
  convert.ts          report@v1 -> allure2 mapping (TS port, deterministic uuids)
  reporter.test.ts    unit tests incl. v1-parity (SDK testReport harness)
dist/allure2-reporter.wasm   prebuilt reporter, committed for download-and-use
src/                  v1 standalone converter (plain JS CLI, unchanged)
fixtures/             real report@v1 document for tests
scripts/
  demo.test.yaml / demo.config.yaml   the demo run (local echo server, no network)
  echo-server.mjs                     deterministic httpbin stand-in
  build-wasm.sh                       npm install + build dist/*.wasm
  generate-fixture.sh                 regenerate fixtures with a real run
.github/workflows/demo.yml            CI: build wasm -> perfscale run -> allure -> Pages
```

## Development

```bash
npm test                 # v1 converter: node:test suite over the real fixture
npm run test:wasm        # wasm reporter unit tests (needs npm --prefix wasm install)
npm run build:wasm       # rebuild dist/allure2-reporter.wasm

# local end-to-end with a real perfscale binary:
node scripts/echo-server.mjs &
perfscale run -f scripts/demo.test.yaml -c scripts/demo.config.yaml -q
allure serve allure-results
```

## License

MIT OR Apache-2.0, at your option — same as perfscale.
