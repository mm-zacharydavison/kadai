#!/bin/bash
# kadai:name Publish
# kadai:emoji 📦
# kadai:description Publish kadai to npm using pubz
# kadai:confirm true
# kadai:interactive true

set -euo pipefail

echo "Building kadai..."
bun run build

echo ""
echo "Publishing with pubz..."
bunx pubz "$@"
