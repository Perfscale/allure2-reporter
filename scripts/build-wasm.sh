#!/usr/bin/env bash
# Build dist/allure2-reporter.wasm from wasm/reporter.ts.
# Uses @perfscale/library-sdk from npm (see wasm/package.json).
set -euo pipefail
cd "$(dirname "$0")/.."

cd wasm
npm install --no-audit --no-fund
npm run typecheck
npm run build
echo "built ../dist/allure2-reporter.wasm"
