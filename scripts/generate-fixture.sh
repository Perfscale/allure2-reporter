#!/usr/bin/env bash
# Regenerate fixtures/sample-report.json with a real perfscale run.
# Requires a perfscale binary; override with PERFSCALE=/path/to/perfscale.
set -euo pipefail
cd "$(dirname "$0")/.."

PERFSCALE="${PERFSCALE:-perfscale}"
"$PERFSCALE" run \
  -f scripts/sample.test.yaml \
  -c scripts/sample.config.yaml \
  --report json:fixtures/sample-report.json \
  --label suite=hello \
  --label env=ci \
  -q
