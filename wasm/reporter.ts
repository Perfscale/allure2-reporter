import { defineReporter } from "@perfscale/library-sdk";
import { convert } from "./convert.ts";

/**
 * `allure2` — perfscale WASM reporter (perfscale:reporter@0.1.0). At the end
 * of the run it renders the canonical `report@v1` document as an Allure2
 * results directory: one test case per step, one per threshold verdict
 * (breached SLOs are "broken", not "failed"), plus `environment.properties`.
 *
 * Config (`with.config`):
 * - `name` (string): override the Allure suite name.
 *
 * Build:  npm run build:wasm
 * Use:
 *   report:
 *     reporters:
 *       - use: wasm:./dist/allure2-reporter.wasm
 *         with:
 *           output: ./allure-results
 *           config: { name: my-suite }
 */
export default defineReporter({
  name: "allure2",
  onReport(report, config, emit) {
    const cfg = (config ?? {}) as { name?: string };
    const files = convert(report, {
      name: typeof cfg.name === "string" ? cfg.name : undefined,
    });
    for (const file of files) {
      emit(file.name, file.contents);
    }
    const results = files.filter((f) => f.name.endsWith("-result.json")).length;
    return `${results} allure2 result(s), ${files.length} file(s)`;
  },
});
