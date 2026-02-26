#!/bin/bash
# xcli:name Publish
# xcli:emoji 📦
# xcli:description Publish xcli to npm using pubz
# xcli:confirm true
# xcli:interactive true

set -euo pipefail

echo "Building xcli..."
bun run build

echo ""
echo "Publishing with pubz..."
bunx pubz "$@"
