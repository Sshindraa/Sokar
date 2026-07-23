#!/usr/bin/env bash
# Wrapper — délègue au script partagé scripts/build/copy-static.sh
exec "$(cd "$(dirname "$0")/../../.." && pwd)/scripts/build/copy-static.sh" dashboard
