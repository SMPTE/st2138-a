#!/bin/bash
set -euo pipefail

echo "🔄 Converting YAML schema to JSON with \$id stripped..."

# 1. Convert YAML to JSON and remove $id
yq 'del(.. | select(has("$id")) | .["$id"])' interface/schemata/device.yaml -o=json > interface/schemata/device.json
echo "✅ Wrote interface/schemata/device.json"

echo "📦 Bundling OpenAPI spec with Redocly CLI..."
# 2. Bundle OpenAPI spec to /docs/openapi.yaml
npx -y @redocly/cli bundle interface/openapi/openapi.yaml -o docs/openapi.yaml
echo "✅ Bundled OpenAPI to docs/openapi.yaml"

echo "📤 Promoting #/components/schemas/device/\$defs to top-level #/components/schemas..."

# 3. Promote subschemas from #/components/schemas/device/$defs to #/components/schemas
yq -i '
  (.components.schemas.device.$defs // {}) as $defs
  | .components.schemas += $defs
  | del(.components.schemas.device.$defs)
' docs/openapi.yaml

echo "✅ Subschemas promoted."