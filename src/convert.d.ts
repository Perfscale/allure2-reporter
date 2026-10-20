/** Type declarations for the v1 standalone converter (src/convert.js). */

export interface ConvertOptions {
  name?: string;
  fallbackName?: string;
}

export interface OutputFile {
  name: string;
  contents: unknown;
  /** True when `contents` is already a serialized string. */
  raw?: boolean;
}

export function uuid(): string;
export function convert(report: unknown, opts?: ConvertOptions): OutputFile[];
export function writeResults(
  report: unknown,
  outDir: string,
  opts?: ConvertOptions,
): string[];
