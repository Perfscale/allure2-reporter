#!/usr/bin/env bash
# Build dist/allure2-reporter.wasm from wasm/reporter.ts.
#
# @perfscale/library-sdk is not on npm yet — we pack it from a local checkout
# of Perfscale/sdk-libraries (ts/ subdir). Set SDK_DIR to override:
#   SDK_DIR=../sdk-libraries/ts ./scripts/build-wasm.sh
# TODO: drop the npm-pack step once @perfscale/library-sdk is published.
set -euo pipefail
cd "$(dirname "$0")/.."

SDK_DIR="${SDK_DIR:-../sdk-libraries/ts}"
SDK_VERSION="$(node -p "require('$SDK_DIR/package.json').version")"
TARBALL="wasm/perfscale-library-sdk-$SDK_VERSION.tgz"

if [ ! -f "$TARBALL" ]; then
  echo "packing @perfscale/library-sdk@$SDK_VERSION from $SDK_DIR"
  rm -f wasm/perfscale-library-sdk-*.tgz
  (cd "$SDK_DIR" && npm pack --pack-destination "$OLDPWD/wasm" >/dev/null)
fi

cd wasm
npm install --no-audit --no-fund
npm run typecheck
npm run build
echo "built ../dist/allure2-reporter.wasm"
