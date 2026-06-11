#! /bin/bash

set -e

dir="$(dirname "$(readlink -f "$0")")"

# run build-openapi to ensure the schema is up to date.
echo "Building schema..."
$dir/../build-openapi.sh


echo ""
echo "Validating examples..."
echo "-------------------"
failures=0

# Loop through all of the examples and validate them.
for example in "$dir"/*.yaml; do
    node "$dir/../tools/validate.js" "$example" || (( ++failures ))
done

echo "-------------------"

if (( failures > 0 )); then
    echo "$failures failure(s) detected."
    exit 1
fi

echo "All examples are valid."