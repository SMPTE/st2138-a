# st2138-a tools

Command-line tooling and a small library for authoring, validating, and
composing SMPTE ST 2138-a device models and parameter descriptors.

The package ships one binary, `st2138`, and a matching library entry point
(`require('smpte-st2138-a-tools')`). Everything the CLI does is also available
programmatically; the CLI is a thin routing layer over the library in
[`src/`](src/).

> This is the user-facing reference for the tool's behavior.
> [`SBOM.md`](SBOM.md) is a living conformance tracker and stays authoritative
> for SBOM minimum-element coverage.

Every YAML snippet below points at a file that is checked in and **validated by
CI**, so the concepts stay concrete and cannot drift:

- descriptor examples under [`../examples/`](../examples) are validated by
  [`../examples/validate.sh`](../examples/validate.sh);
- import/template/namespace composition cases under
  [`features/cases/`](features/cases) are validated by the integration suite
  (`npm run integration`).

## Running the tool

From anywhere in the repository, use the convenience wrapper (no install
needed):

```bash
./st2138.sh validate examples/device.example.yaml
```

Or invoke the CLI directly / after publishing:

```bash
node tools/bin/cli.js validate examples/device.example.yaml
npx st2138 validate device.mydevice.yaml   # once installed as a dependency
```

Every command accepts a local path or a URL as its `<file>` argument.

## Commands

### `validate`

Validate a single descriptor against the ST 2138-a schema and run the semantic
checks.

```bash
st2138 validate examples/param.on_off.yaml
```

| Option | Effect |
| --- | --- |
| `--digest <base64>` | verify the file's raw bytes against a pinned base64 SHA-256 digest before validating |
| `--resolve` | resolve imports first, then validate the merged, template-expanded descriptor |
| `--disable-mandatory-enforcement` | skip the mandatory-parameter checks |

Exit code is `0` on success and `2` on validation failure. Diagnostics carry
1-based line numbers into the original file.

Without `--resolve`, a descriptor that defers part of its model to an import is
validated **as authored**: an unresolved `import` stub is schema-valid, so the
check reports a hint rather than failing on the placeholder. Use `--resolve`
(or the `resolve` command) to check the fully assembled model.

### `resolve`

Inline a descriptor's imports and expand its templates into one self-contained
descriptor, printed to stdout (diagnostics go to stderr, so stdout can be
redirected cleanly).

```bash
st2138 resolve examples/param.import.yaml            # YAML to stdout
st2138 resolve device.example.yaml --output out.yaml # or to a file
st2138 resolve device.example.yaml --json            # emit JSON instead
```

| Option | Effect |
| --- | --- |
| `--digest <base64>` | pin the root file's bytes before resolving |
| `--output <file>` | write the descriptor to a file instead of stdout |
| `--json` / `--yaml` | choose the output format (default YAML, or inferred from `--output` extension) |
| `--disable-template-expansion` | inline imports but leave `template_oid` references unexpanded |
| `--sbom <file>` | also write a CycloneDX SBOM of every file that was loaded |
| `--disable-mandatory-enforcement` | skip the mandatory-parameter checks |

The SBOM and its `ST2138_SBOM_*` environment variables are documented in
[`SBOM.md`](SBOM.md) and in `st2138 resolve --help`.

### `digest`

Print the base64 SHA-256 digest of a file's raw bytes — the value that goes in
an import's `digest:` field. Read-only; the file is not parsed or validated.

```bash
st2138 digest examples/param.on_off.yaml
# U0R1rCOixZhOa/PPQ88NHzWcyEkxfppToo+n4GOT85I=
```

This is the correct way to compute a digest; hashing by hand is error-prone (a
common trap is base64-ing the 64-character *hex* text instead of the 32 raw
bytes). The equivalent shell form is
`openssl dgst -sha256 -binary <file> | base64`.

### `pin`

Fill in or refresh the `digest:` on each import in a descriptor, computing it
from the current bytes of each import target. Dry-run by default (reports
changes to stderr); `-w` rewrites the file in place, preserving comments,
anchors, and key order.

```bash
st2138 pin device.example.yaml        # preview
st2138 pin device.example.yaml -w     # apply
```

| Option | Effect |
| --- | --- |
| `-w`, `--write` | rewrite the file in place instead of only reporting (local files only) |
| `--include-local` | also pin local (`file:`) imports, not just remote ones |

By default `pin` only pins **remote** imports: a digest on a local sibling is
redundant with your version control's own content hashing and would restale on
every edit, so pinning locals is opt-in and typically reserved for a
pre-publish freeze. Pinning records **integrity only, not validity** — run
`validate --resolve` afterward to confirm the descriptor still resolves.

## Artifact naming and schema selection

The tool selects which schema to apply from the **first dot-separated segment
of the filename**:

```text
<kind>.<name>.<ext>       device.example.yaml -> device schema
                          param.on_off.yaml   -> param  schema
                          command.play.yaml   -> command schema
```

This convention is load-bearing and applies to imported files too — each file
in an import graph is validated against the schema its own name implies, so
imported descriptors must follow it. One artifact is exactly one document;
multi-document (`---`) YAML is not accepted.

## Imports

An import pulls another descriptor in at the point of the directive. It is a
param/command-level field (the device root has no `import`), so imported files
are themselves param or command descriptors and resolve recursively.

```yaml
# ../examples/param.import.yaml
import:
  url: ./param.on_off.yaml
  digest: U0R1rCOixZhOa/PPQ88NHzWcyEkxfppToo+n4GOT85I=
```

- **`url`** (required) is a URI reference. A relative URL resolves against the
  importing file's own location, so sibling imports (`./param.on_off.yaml`)
  work locally and after publishing.
- **`digest`** (optional) is a base64 SHA-256 of the target's raw bytes. When
  present it is verified on load; a mismatch is a hard, located error. Generate
  it with `st2138 digest` or fill it in with `st2138 pin`.

### The shallow-merge rule

An import **merges** with the keys authored alongside it — it is not a plain
replacement. The imported file is the base and the importing node's other keys
are local overrides. The merge is deliberately **shallow — one level deep — and
local always wins**:

- every key the local node defines replaces the imported counterpart *wholesale*;
- keys present on only one side survive;
- the `import` key itself is dropped from the result.

```yaml
# features/cases/import_merge/param.input.yaml
import:
  url: ./param.on_off.yaml   # target sets minimal_set: true
minimal_set: false           # local override wins -> result is false
```

**Why shallow, not deep.** A parameter's `value` is a discriminated union keyed
by its `type` (`int32_value`, `float32_value`, `struct_value`, …). If a local
node changes the `type` of an imported base, a deep merge would blend the base's
`value` with the local's into a two-branch union — a shape the schema rejects.
Replacing each top-level key wholesale means a local override stands *in place
of* the imported value rather than blending into it, so the result is always a
single coherent variant. The same rule powers template expansion (below), via
one shared merge primitive in [`src/shape.js`](src/shape.js).

### When an import cannot be resolved

A missing target, an integrity (digest) mismatch, malformed YAML, or an import
**cycle** (a file that imports one already open on the path to it) is reported
as a located diagnostic at the offending `import` in the *importing* file, and
that subtree stops there — one unreachable import does not abort the whole
resolution. Blame lands on the `import` you wrote, not on the far end where the
failure was detected.

### Provenance

Every file actually loaded during resolution is recorded, with its computed
digest and its direct-import edges, and surfaced as the dependency graph in the
CycloneDX SBOM (`resolve --sbom`). See [`SBOM.md`](SBOM.md).

A descriptor can also **self-declare** its producer, license, version, and
copyright — assertions only its author can make truthfully — in a structured
comment block at the top of the file. The tags follow the SPDX/REUSE convention
where one exists, with a small `st2138-` namespace for the fields SPDX has no
file-level tag for:

```yaml
# SPDX-FileCopyrightText: 2026 SMPTE
# SPDX-License-Identifier: BSD-3-Clause
# st2138-supplier: SMPTE <https://www.smpte.org>
# st2138-version: 1.2.0
type: STRUCT
params:
  ...
```

Because provenance lives only in comments, it stays in the artifact but never
enters the parsed model, so the schema stays closed with no key to declare —
which also makes it **YAML-only** (a JSON descriptor has no comment channel).
Recognized tags may sit anywhere in the leading comment block, interleaved with
the free-form description comments a descriptor already carries; unrecognized
lines are ignored. This is the recommended way to make a published, importable
fragment carry its own license and origin. What the tool does with these fields
(precedence over pipeline defaults, explicit-`Unknown` fallbacks) is detailed in
[`SBOM.md`](SBOM.md); the parser is [`src/provenance.js`](src/provenance.js).

## Templates

A parameter can borrow the shape of another parameter in the same resolved model
with `template_oid`, which holds the fully qualified OID (FQOID) of the source —
a `/`-joined path of parameter names from the descriptor root.

```yaml
# features/cases/template_oid/param.input.yaml
params:
  length:                         # the template source
    type: INT32
    constraint: { type: INT_RANGE, int32_range: { min_value: 0, max_value: 100 } }
    client_hints:
      st2138_definition_only: "true"

  width:
    type: INT32
    template_oid: length          # inherits length's constraint...
    value: { int32_value: 50 }    # ...but keeps its own value
```

Expansion uses the **same shallow, local-wins rule** as imports: each consumer
is filled with the source's keys it is *missing*, and never has its own keys
overwritten. So `width` and `height` above each pick up `length`'s range
constraint while keeping their own `value`.

Other behaviors, each pinned by an integration case:

- **Nothing is removed.** The source stays in the tree and the consumer keeps
  its `template_oid` as provenance of where its shape came from.
- **`template_oid` itself is never inherited** — a consumer keeps its own,
  not the source's.
- **Chains resolve transitively.** A source that is itself a consumer is
  materialized first — see [`features/cases/template_chain/`](features/cases/template_chain).
- **Cycles and unresolved references are errors**, reported without expanding.
- **References rebase on import.** A shared library whose types reference each
  other internally (e.g. a `segment` templating a sibling `point`) still
  resolves after it is mounted under an import name: every `template_oid` in the
  imported subtree is prefixed by the mount point so it stays absolute from the
  descriptor root — see
  [`features/cases/template_internal/`](features/cases/template_internal).

Pass `--disable-template-expansion` to `resolve` to inline imports but leave
`template_oid` references as authored.

## Reserved client hints

`client_hints` is an open string-to-string map, but ST 2138-a reserves a small
family of keys under the `st2138_` prefix that steer **resolution and code
generation** rather than clients. Any `st2138_`-prefixed key that is not one of
the reserved names is rejected. Their single source of truth is
[`src/hints.js`](src/hints.js).

| Key | Value | Meaning |
| --- | --- | --- |
| `st2138_namespace` | dotted namespace, e.g. `smpte.audio` | names a canonical, language-neutral generated scope for the definitions beneath it; **implicitly definition-only** |
| `st2138_definition_only` | the exact string `"true"` | marks the declaration and its whole subtree as build-time only |

```yaml
# features/cases/template_internal/param.geo.yaml
client_hints:
  st2138_namespace: shared.geo   # a reusable, namespaced type library
```

Key points:

- **Values are strings.** `client_hints` is a `map<string, string>`; write
  `st2138_definition_only: "true"`, not a YAML boolean. Any value other than the
  exact string `"true"` is rejected rather than coerced.
- **Namespaces are dotted**, not `::`-separated. The accepted form is
  dot-separated identifier segments (matching `NAMESPACE_PATTERN` in
  [`src/hints.js`](src/hints.js)); a generator maps that logical name to its
  target language (C++ `namespace`, Go package, Rust modules, …).
- **Definition-only means the whole subtree.** A definition-only or namespace
  node — and everything under it — is a build-time library: it provides shapes
  and defaults for `template_oid` consumers but produces no runtime parameter,
  so the value-placement checks exempt it.
- **These hints are lexical and are not inherited through `template_oid`.**
  They describe the *declaration site*, so a consumer that templates a
  namespaced or definition-only source does **not** become namespaced or
  definition-only itself.

A fuller example combining an import, a namespaced library, a definition-only
type, and a template consumer lives in
[`features/cases/device/`](features/cases/device).

## Validation checks

Beyond JSON Schema, the tool runs a set of semantic checks (in
[`src/checks/`](src/checks)) and reports them as diagnostics with line numbers:

- **mandatory** — device-level required-parameter enforcement (skippable with
  `--disable-mandatory-enforcement`).
- **nested-values** — flags values placed at levels that will be silently
  ignored at runtime, while exempting template sources and definition-only
  subtrees.
- **scopes** — validates access-scope usage (e.g. `st2138:op`).
- **client-hints** — enforces the reserved-hint rules above.
- **digest** — checks that any authored import `digest` is a decodable base64
  SHA-256.

Plain `validate` runs every check. During `resolve`, checks run in two phases:
a per-fragment **gate** as each file is inlined (schema + digest decodability),
then the whole-model **report** checks (mandatory, scopes, nested-values,
client-hints) once over the fully assembled, template-expanded model — because
those judgments are only meaningful after imports resolve.

## Library API

```js
const {
  validate,          // (url, options) -> Promise<ValidationResult>
  resolve,           // (url, options) -> Promise<ResolutionResult> (imports inlined, templates expanded)
  digest,            // (url, options) -> Promise<string> (base64 sha256)
  toCycloneDx,       // (resolutionResult, subject, options) -> string (CycloneDX JSON)
  printDiagnostics,  // (diagnostics) -> void
  formatDiagnostic,  // (diagnostic) -> string
} = require('smpte-st2138-a-tools');
```

Public option and result types are declared in [`src/types.d.ts`](src/types.d.ts).
A `ValidationResult`/`ResolutionResult` carries `valid`, `diagnostics`, and
`data`; read `data` only when `valid` is true.

## Future work

Deferred by design — the shape of each is settled, but none is built yet.


- **Template expansion inside commands.** Template expansion walks a
  descriptor's `params` tree only, so a `template_oid` on a command's argument
  param is left as authored rather than filled in, and an FQOID cannot address a
  param under `commands` to name it as a source. Extending the expansion walk to
  descend `commands` would let a command's params borrow shapes exactly as
  top-level params do.
- **Recursive and CI pinning.** `pin --recursive` would pin a whole local
  subtree bottom-up (a leaf's digest changes its parent's), for locking a
  reusable library at its pre-publish freeze; `pin --check` would report whether
  a descriptor's pins are current without writing, as a CI gate.
- **A closure lockfile.** `pin` writes an in-file `import.digest`, which is
  inherently shallow at a remote boundary — you can pin your import of a remote
  file, but not that file's own imports. A flat lockfile emitted by `resolve`,
  enumerating the entire transitive set with digests, would give self-sufficient
  integrity without trusting every upstream author to have pinned.
- **Fragment audit mode.** A shared param fragment destined for publication is
  meant to be self-contained, so an opt-in audit could run the whole-model
  checks against a lone fragment — flagging values that no consumer references
  and that are not marked definition-only, findings that are deliberately silent
  during a normal `resolve`.
- **Cross-file line numbers.** Report-phase diagnostics run once over the
  assembled model against the root file's source map, so a finding inside an
  imported fragment currently has no line number. A composed, cross-file source
  map would attribute each diagnostic back to the file and line that authored it.
- **Richer SBOM identity.** Component Identifiers (CPE / PURL) are not emitted —
  ST 2138-a descriptors are neither NVD products nor packages in an ecosystem —
  and an `--sbom-<format>` split could offer alternates alongside CycloneDX.
  Signing the SBOM (the CISA *Author Signature* element) stays a downstream
  release-pipeline step (e.g. `cyclonedx-cli` or cosign), not something this tool
  does.

## Development

```bash
npm test          # jest with 100% coverage gate (unit)
npm run typecheck  # tsc against the public types
npm run integration # cucumber composition cases
npm run test:all   # all three, in fail-fast order
```

Coverage is held at 100% for `src/`. The CLI in [`bin/`](bin) is a thin
routing layer and is intentionally not coverage-tracked; its logic lives in the
library so it can be tested and reused.
