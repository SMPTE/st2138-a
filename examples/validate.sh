#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# run build-openapi to ensure the schema is up to date.
echo "Building schema..."
cd "$SCRIPT_DIR/.."
./build-openapi.sh

echo ""
echo "Validating examples..."
echo "-------------------"
failures=0

# Loop through all of the examples and validate them.
for example in "$SCRIPT_DIR"/*.yaml; do
    node "$SCRIPT_DIR/../tools/validate.js" "$example" || (( ++failures ))
done

echo "-------------------"

if (( failures > 0 )); then
    echo "$failures failure(s) detected."
    exit 1
fi

echo "All examples are valid."
