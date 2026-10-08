#!/usr/bin/env bash
set -euo pipefail
root=$1
cwd=$2
package=$3
node scripts/verify-launch-shell.mjs alias "$root/alias" "$cwd" "$package"
node scripts/verify-launch-shell.mjs function "$root/function" "$cwd" "$package"
