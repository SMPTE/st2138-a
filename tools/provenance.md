## Proposal: descriptor provenance (for team review)

Three ⬜ Component Data elements — **Producer**, **License**, and **Version** —
plus the component half of **Explicitly Identifying Unknown Information** all
depend on the same missing capability: **descriptor files carry no provenance
metadata**. This section sketches how to add it.

> **Status:** the *pipeline-default* layer is now implemented — local components
> inherit `ST2138_SBOM_PRODUCER` / `ST2138_SBOM_LICENSE` / `ST2138_SBOM_VERSION`,
> and everything unset (or remote) is marked explicit `Unknown`/`NOASSERTION`.
> What remains is reading provenance *from the descriptors themselves* (the
> shapes below), which would then override the pipeline defaults.

### Why not derive it from the fetch URL

The obvious shortcut for a remote import is to reuse the URL it was fetched from
as the producer. This does not hold up:

- A URL is a *location*, not an *identity*. `smpte.github.io` conflates the host
  (GitHub Pages) with the author (SMPTE); `raw.githubusercontent.com/SMPTE/…` is
  a CDN delivery path, even further from an identity claim.
- CISA's Component Producer is "the entity that creates, defines, and identifies
  components" — an assertion only the artifact's author can make truthfully.
  Inferring it from a host is guessing, which the Explicitly-Identifying-Unknown
  element tells us not to do.
- The fetch URL already has a correct home: remote components emit an
  `externalReferences[]` entry of type `Distribution`. That is "where it came
  from"; it should stay there and not be overloaded as producer.

Conclusion: producer, license, and version are **self-assertions** and must be
declared *in the descriptor* by whoever authored it.

### Prior art: MXL `$`-prefixed metadata

The [Media eXchange Layer](https://github.com/dmf-mxl/mxl) project already does
this in its flow descriptors. For example,
[`v210_flow.json`](https://raw.githubusercontent.com/dmf-mxl/mxl/refs/heads/main/lib/tests/data/v210_flow.json)
carries, at the document root:

```json
{
  "$copyright": "SPDX-FileCopyrightText: 2025 Contributors to the Media eXchange Layer project.",
  "$license": "SPDX-License-Identifier: Apache-2.0",
  ...
}
```

The `$`-prefix marks keys the consuming application ignores, and the values are
SPDX strings (`SPDX-License-Identifier`, `SPDX-FileCopyrightText`) so they are
machine-processable. This is a clean, low-ceremony precedent from an adjacent
media-tech project and validates putting license at the descriptor root.

### Candidate shapes

Each descriptor file becomes exactly one SBOM component, so the natural scope is
the **file root** (unlike `client_hints`, which is per-param because it hints a
single param's UI widget). Two shapes are worth weighing:

**Option A — MXL-style `$`-prefixed keys**

```yaml
$copyright: "SPDX-FileCopyrightText: 2026 SMPTE"
$license:   "SPDX-License-Identifier: BSD-3-Clause"
$producer:  "SMPTE"
$version:   "1.2.0"
```

- Pro: matches an existing sibling-project convention; flat and terse; the `$`
  visually separates metadata from model content.
- Con: `$` is JSON Schema's own vocabulary namespace (`$schema`, `$id`, `$ref`,
  `$defs` already appear in our schemata), so `$license` reads like a schema
  keyword; SPDX-string-in-a-string needs parsing before it maps to CycloneDX.

**Option B — a single `provenance` object**

```yaml
provenance:
  supplier: { name: "SMPTE", url: "https://www.smpte.org" }
  version:  "1.2.0"
  license:  "BSD-3-Clause"     # SPDX id or expression
  copyright: "2026 SMPTE"
```

- Pro: one well-known key; fields map 1:1 onto CycloneDX component fields so the
  renderer stays a dumb mapper; no `$` collision; naturally structured (supplier
  name + URL) rather than packed into a string.
- Con: a new bespoke key rather than an existing convention; slightly more
  verbose.

Either way, because the root schema is `additionalProperties: false`
([device.yaml](../interface/schemata/device.yaml)), the chosen keys must be
**explicitly declared in the schema** — nothing is "ignored for free." Making
the block optional keeps every existing descriptor valid.

### Mapping to CycloneDX and CISA

| Descriptor field | CycloneDX | CISA element |
| --- | --- | --- |
| producer / supplier | `component.supplier` | Component Producer |
| version | `component.version` | Component Version |
| license | `component.licenses` (SPDX id/expression) | Component License |
| copyright | `component.copyright` | (supports Producer/License context) |

### Semantics to settle

- **No inheritance by default.** An imported file is authored independently and
  may carry a different license or producer than its parent; copying a parent's
  claim downward would fabricate provenance. Each file self-declares.
- **Missing → explicit Unknown / NOASSERTION** on that component's fields. This
  is already how the tool behaves for the pipeline-default layer; descriptor
  provenance would simply supply real values in place of `Unknown` where the
  file declares them.
- **Repo-wide defaults** (e.g. "everything here is SMPTE / BSD-3-Clause") are a
  tooling/config concern, not model data — the same reasoning that put the SBOM
  author in an env var rather than a per-run flag. This layer is implemented via
  the `ST2138_SBOM_*` variables; descriptor provenance, once added, takes
  precedence over it.

### Open questions for the team

1. Option A (`$`-prefixed, MXL-aligned) vs Option B (`provenance` object)?
2. SPDX identifiers only, or also allow a license URL for non-SPDX terms?
3. Should we adopt `$copyright`/`$license` verbatim for cross-project
   consistency with MXL, even under Option B?
4. Is per-file `version` meaningful for these descriptors, or should version
   stay `Unknown` until there is a real release process?