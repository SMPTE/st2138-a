#!/bin/bash
set -euo pipefail

echo "🔄 Converting YAML schema to JSON with \$id stripped..."

# 1. Convert YAML to JSON and remove $id and x-anchors
# first resolve any anchors
mkdir -p build
# TODO: Remove --yaml-fix-merge-anchor-to-spec flag after yq defaults to true (late 2025)
yq --yaml-fix-merge-anchor-to-spec 'explode(.) | del(.["x-anchors"])' interface/schemata/device.yaml -o=yaml > build/device.yaml
# then remove $id fields and convert to JSON
yq 'del(.. | select(has("$id"))["$id"])' build/device.yaml -o=json > interface/schemata/device.json
# 2. Copy device.json to tools/data/device.json
mkdir -p tools/data
cp interface/schemata/device.json tools/data/device.json

echo "📦 Bundling OpenAPI spec with Redocly CLI..."

# 2. Bundle OpenAPI spec to /docs/openapi.yaml
npx -y @redocly/cli bundle interface/openapi/openapi.yaml -o docs/openapi.yaml

echo "✅ Bundled OpenAPI to docs/openapi.yaml"

echo "📤 Promoting #/components/schemas/device/\$defs to top-level #/components/schemas..."

# 4. Promote subschemas from #/components/schemas/device/$defs to #/components/schemas
yq -i '
  (.components.schemas.device.$defs // {}) as $defs
  | .components.schemas += $defs
  | del(.components.schemas.device.$defs)
' docs/openapi.yaml

echo "✅ Subschemas promoted."