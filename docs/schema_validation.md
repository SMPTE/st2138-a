# Schema Validation

There are multiple examples of device models, and parameter descriptors
in this repo.

If you're using vscode or cursor, you can turn on validation and
tooltips for the examples by putting these lines into your
local `settings.json`

```json
"yaml.schemas": {
  "https://smpte.github.io/st2138-a/interface/schemata/device.yaml#/$defs/param": ["**/param.*.yaml"],
  "https://smpte.github.io/st2138-a/interface/schemata/device.yaml": ["**/device.*.yaml"]
}
```

## Command Line

You can install the validator globally:

```bash
npm install -g smpte-st2138-a-validator
```

Then run

```bash
st2138-a-validate ./data/device.good.yaml
```

Or ust npx to run without installation

```bash
npx smpte-st2138-a-validator ./data/device.example.yaml
```

