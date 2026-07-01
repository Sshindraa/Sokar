#!/usr/bin/env bash
# Wrapper — délègue au script partagé scripts/copy-static.sh
exec "$(cd "$(dirname "$0")/../../.." && pwd)/scripts/copy-static.sh" connect
