# SBOM Minimum Elements — Conformance

Tracks how the `st2138` tooling satisfies each element of CISA's
[2026 Minimum Elements for a Software Bill of Materials (SBOM)](https://www.cisa.gov/sites/default/files/2026-07/2026_cisa_sbom_minimum_elements_508c.pdf).

The tool emits a CycloneDX 1.6 JSON SBOM via `st2138 resolve --sbom <file>`.

**Status legend:** ✅ implemented · 🚧 partial · ⬜ not started · ➡️ delegated (handled outside this tool)

## Scope and interpretation

- SBOM Metadata elements describe the SBOM document itself.
- Component Data elements apply to the target component and all enumerated
  subcomponents.
- A field in a specific SBOM format may satisfy one or more minimum elements,
  and the format's field names do not have to match the CISA element names.
- The practices and processes elements describe how SBOM data is generated,
  updated, shared, and managed; they may require tool behavior, release-pipeline
  behavior, or organizational policy rather than a single CycloneDX field.
- An organization should explicitly address the practices and processes in any
  policy, contract, or arrangement used to request or provide SBOMs.
- When similar component information appears in different contexts, SBOM
  authors should err on the side of duplication or redundancy for clarity and
  reliable identification.
- The minimum elements apply to all software, including open source software,
  AI software, and software as a service (SaaS). Additional elements may be
  needed for particular software types.

## Conformance summary

### SBOM Metadata

| Element | Status | Where / Evidence |
| --- | --- | --- |
| SBOM Author | ✅ | `metadata.authors` (env-supplied) |
| SBOM Author Signature | ➡️ | external signing step |
| SBOM Data Format Name | ✅ | `bomFormat: "CycloneDX"` |
| SBOM Data Format Version | ✅ | `specVersion: "1.6"` |
| SBOM Generation Context | ✅ | `metadata.lifecycles` = `pre-build` |
| SBOM Timestamp | ✅ | `metadata.timestamp` |
| SBOM Tool Name | ✅ | `metadata.tools[].name` |
| SBOM Tool Version | ✅ | `metadata.tools[].version` |
| SBOM Version | ✅ | `version` + `serialNumber` |

### Component Data

| Element | Status | Where / Evidence |
| --- | --- | --- |
| Component Producer | 🚧 | `component.supplier` (local default / `Unknown`; remote provenance TODO) |
| Component Dependency Relationship | ✅ | `dependencies[]` |
| Component Hash Value | ✅ | `components[].hashes[].content` |
| Component Hash Algorithm | ✅ | `components[].hashes[].alg` |
| Component Identifiers | 🚧 | `bom-ref` content hash; no CPE/PURL |
| Component License | 🚧 | `component.licenses` (local default / `NOASSERTION`; remote provenance TODO) |
| Component Name | ✅ | `components[].name` |
| Component Version | 🚧 | `component.version` (local default / `Unknown`; remote provenance TODO) |

### Practices and Processes

| Element | Status | Where / Evidence |
| --- | --- | --- |
| Accommodation of Updates to SBOM Data | ⬜ | organizational process |
| Coverage | ✅ | full transitive import closure |
| Distribution and Delivery | ⬜ | organizational / pipeline |
| Explicitly Identifying Unknown Information | ✅ | author + producer/license/version marked explicitly |
| Frequency | 🚧 | fresh SBOM per run; cadence is policy |
| Machine-Processable Data | ✅ | CycloneDX 1.6 JSON |

## SBOM Metadata

### SBOM Author — ✅ implemented

> The name of the entity that creates the SBOM data for the target component.
> Captures the entity operating the tool to generate the SBOM, not the tool
> itself.

- **CycloneDX field:** `metadata.authors[]` (`OrganizationalContact` with
  `name`, optional `email`) — distinct from the tool (`metadata.tools`) and from
  the component producer.
- **How it's supplied:** read from the environment, since the author is a
  constant of the publishing pipeline rather than a per-run argument:
  - `ST2138_SBOM_AUTHOR` — full name of the entity, e.g. `Acme Corporation`
    (use full names, not acronyms, unless the official name has one).
  - `ST2138_SBOM_AUTHOR_EMAIL` — optional contact email.
- **When unset:** the author is recorded as an explicit `Unknown` (never guessed
  into a real name, never silently omitted) and a warning is printed to stderr.
  A downstream step can overwrite `Unknown` with the real author (e.g. with
  `cyclonedx-cli`).
- **Not derived from git identity:** the committer is not the SBOM author, and
  scraping it would leak a person's name/email.

### SBOM Author Signature — ➡️ delegated

> A digital signature attributable to the SBOM author.

- The signature provides assurance that the claimed signatory signed the
  SBOM and that the data was not modified after signature generation.
- The signature algorithm should be approved for secure use under applicable
  regulations or recommendations, such as the NIST Digital Signature Standard,
  ISO/IEC 14888-4:2024, or ENISA cryptographic guidance.
- **Not produced by this tool** — signing is a release-pipeline concern involving
  key custody and signature policy, and the CycloneDX JavaScript library does
  not sign.
- **Recommended approach:** sign the emitted SBOM as a downstream CI step, e.g.
  with [`cyclonedx-cli`](https://github.com/CycloneDX/cyclonedx-cli), a detached
  signature via [cosign](https://github.com/sigstore/cosign)/sigstore, or an
  embedded JSF `signature` property.

### SBOM Data Format Name — ✅ implemented

> The name of the data format used to represent the SBOM data.

- Identify the data format used to generate and consume the SBOM.
- **Implementation:** The serializer emits `bomFormat: "CycloneDX"`.

### SBOM Data Format Version — ✅ implemented

> Identifier designated by the SBOM data format to specify the version of the
> data format.

- Record the version of the format named by SBOM Data Format Name.
- Do not use a version declared deprecated by the organization maintaining the
  data format.
- **Implementation:** Emits `specVersion: "1.6"` (CycloneDX 1.6, via `Spec.Spec1dot6`).

### SBOM Generation Context — ✅ implemented

> The relative software lifecycle phase and data available at the time the SBOM
> author generated the SBOM.

- Record the lifecycle phase that produced the represented component data.
- General values such as `before build`, `build`, and `after build`, or more
  specific identifiers, can satisfy the element.
- For example, an SBOM generated from source code can be identified as
  `before build`, while one generated by binary analysis can be identified as
  `after build`.
- **Implementation:** `metadata.lifecycles` is set to `pre-build`, since the
  SBOM is generated from source descriptors before any product build.

### SBOM Timestamp — ✅ implemented

> Record of the date and time of the most recent update to the SBOM data.

- Record when the SBOM author most recently changed the SBOM data, manually or
  with a tool.
- Each version of an SBOM should have a new timestamp.
- The value should conform to
  [RFC 9557](https://www.rfc-editor.org/info/rfc9557).
- **Implementation:** `metadata.timestamp` records generation time as an RFC 3339
  UTC instant (`new Date().toISOString()`), a valid RFC 9557 timestamp.

### SBOM Tool Name — ✅ implemented

> The name of the tool used by the SBOM author to generate or amend the SBOM.

- Use the tool's full name, without acronyms unless an acronym is part of the
  tool's official name.
- **Implementation:** `metadata.tools[]` records vendor `SMPTE` and name
  `smpte-st2138-a-tools`.

### SBOM Tool Version — ✅ implemented

> Identifier for the version of the tool identified in the SBOM Tool Name
> element.

- Record the tool version so a specific code delivery of the generator or
  amendment tool can be identified.
- If no version identifier is available, explicitly state that the information
  is unknown.
- **Implementation:** `metadata.tools[].version` from the tool's `package.json`.

### SBOM Version — ✅ implemented

> Identifier designated by the SBOM author to specify a change in the SBOM
> document from a previously identified version or to indicate that it is the
> first version.

- Track the SBOM version separately for each component-name/component-version
  pair.
- Update the SBOM version whenever data about the target component is edited.
- Semantic Versioning may be used. Under the guidance, the major version of a
  published SBOM following these minimum elements should be `1`; minor and
  patch versions can indicate later content changes as appropriate.
- If a serial number or other unique identifier differentiates SBOM versions,
  use a relevant standard, such as
  [RFC 9562](https://www.rfc-editor.org/info/rfc9562) for UUIDs.
- **Implementation:** Emits `version: 1` plus a fresh `serialNumber`
  (`urn:uuid:…`, RFC 9562) per generation. Not incremented across edits — each run
  is an independent document uploaded to the SBOM store.

## Component Data

### Component Producer — 🚧 partial

> The name of an entity that creates, defines, and identifies components.

- Use a human-readable full name and avoid acronyms unless an acronym is part of
  the producer's official name.
- Identify only one organization as the producer for a given component.
- For open source software, use applicable ecosystem conventions; otherwise use
  the original project or maintaining organization when available.
- If there is no clear producer, explicitly identify the component as having
  unknown provenance.
- This element is distinct from SBOM Author and replaces the 2021
  `Supplier Name` element.
- **Implementation:** `component.supplier.name`. Local (`file:`) components take
  `ST2138_SBOM_PRODUCER`, since they share this repo's origin; remote imports
  cannot be spoken for. Anything unset is an explicit `Unknown`, never guessed
  from the fetch URL. TODO: let descriptor-declared provenance override this.

### Component Dependency Relationship — ✅ implemented

> The relationship between two components, where one component is necessary for
> the operation of the other.

- Record how the target component includes each subcomponent so consumers can
  build a dependency graph.
- The relationship may be represented through embedded component data or by
  linking to a separate SBOM for a dependency.
- **Implementation:** `dependencies[]` records each file's direct imports as
  graph edges; shared imports (diamonds) collapse to one node.

### Component Hash Value — ✅ implemented

> The output generated from applying a cryptographic hash algorithm to an
> executable component artifact.

- Record the hash as an ASCII, hexadecimal-encoded value produced from the
  executable component artifact.
- If the SBOM author cannot access the executable artifact, explicitly state
  that the value is unknown.
- If the selected data format permits alternate encodings, represent them in a
  machine-processable and automatable way.
- **Implementation:** `components[].hashes[].content` — hex sha256 of the bytes
  actually loaded for each file.

### Component Hash Algorithm — ✅ implemented

> The cryptographic algorithm used to compute the Component Hash Value of the
> software component.

- Identify the algorithm using an
  [IANA Hash Function Textual Name](https://www.iana.org/assignments/hash-function-text-names/hash-function-text-names.xhtml).
- Use an algorithm approved by a relevant authority, such as NIST.
- **Implementation:** `components[].hashes[].alg` = `SHA-256`.

### Component Identifiers — 🚧 partial

> Identifiers used to identify a component or serve as a look-up key for
> relevant databases.

- Include at least one software identifier associated with the component.
- Prefer common, machine-processable identifiers such as CPE or Package-URL
  (PURL).
- The field may also include UUIDs, organization-specific identifiers, commit
  hashes, and intrinsic identifiers such as OmniBOR and SWHID.
- If multiple identifiers exist, include all of them.
- **Implementation:** `bom-ref` is `<name>@sha256:<hex>`, an intrinsic
  content-hash identifier. No CPE or PURL — descriptor files have neither.

### Component License — 🚧 partial

> The identifier(s) for the license(s) under which the software component is
> available.

- Use identifiers that allow an SBOM recipient to locate the complete license
  terms.
- When possible, provide the data in a machine-processable form, such as SPDX
  license identifiers.
- If no license identifier exists, provide another way to locate the complete
  terms, such as a URL.
- Include information about proprietary license conditions.
- If the license information is not known, explicitly identify it as unknown.
- **Implementation:** `component.licenses`. Local components take
  `ST2138_SBOM_LICENSE` (an SPDX id such as `BSD-3-Clause`); when unset, or for a
  remote import, the license is an explicit `NOASSERTION`. TODO: let
  descriptor-declared provenance override this, and emit a typed SPDX license.

### Component Name — ✅ implemented

> The name assigned by the component producer to a software component.

- Use the producer-assigned, human-readable component name.
- Keep this value distinct from Component Identifiers.
- Support multiple entries so alternate names can be recorded.
- Use full names and avoid acronyms unless an acronym is part of the official
  component name.
- **Implementation:** `components[].name` — the descriptor's filename.

### Component Version — 🚧 partial

> Identifier used by the component producer to specify a change in a software
> component from a previously identified version or to indicate that it is the
> first version.

- Record the producer-provided version so the SBOM identifies a specific code
  delivery.
- If the component producer does not provide a version, explicitly state that
  the information is unknown.
- **Implementation:** `component.version`. Local components take
  `ST2138_SBOM_VERSION`; when unset, or for a remote import, the version is an
  explicit `Unknown`. TODO: let descriptor-declared provenance override this.

## Practices and Processes

These elements may be satisfied by generator behavior, release automation,
delivery mechanisms, or documented organizational processes. They are tracked
here because the 2026 guidance treats them as minimum SBOM elements alongside
the data fields.

### Accommodation of Updates to SBOM Data — ⬜ not started

> Organizations should accommodate updates to SBOM data, including corrections.

- Correct SBOM errors promptly.
- Ensure the SBOM can be revised when corrections or new information become
  available.
- Organizations may consider errors caused by author practices or inadequate
  tools in their risk-management decisions.
- **Implementation:** Organizational process. The tool regenerates a full SBOM
  on demand, but correcting and re-issuing is a pipeline/policy concern.

### Coverage — ✅ implemented

> An SBOM should include information for all components that make up the target
> software, including transitive dependencies. There is no minimum depth.

- Include all direct and transitive components needed to make up the target
  software.
- List separate instances when the same software component appears with
  different metadata, and record the appropriate dependency relationship for
  each instance.
- Non-code files may be excluded, but security-relevant files such as
  configuration files may be included.
- Coverage should be comprehensive enough to support risk-based conclusions;
  for example, a recipient should be able to use the absence of a component to
  conclude that a vulnerability associated with that component does not affect
  the software.
- Linked SBOMs may satisfy coverage for subcomponents or dependencies only when
  recipients can access all linked SBOMs.
- **Implementation:** `resolve` inlines the full transitive import closure;
  every loaded file becomes a component (deduped by URL).

### Distribution and Delivery — ⬜ not started

> SBOMs should be available promptly to those who need them.

- Access controls may prevent unauthorized access, but should not block sharing
  among authorized parties or prevent integration into trusted security tools.
- Delivery may accompany installation or use a version-specific URL, an API to
  a database, or a public repository.
- Any service used to deliver SBOMs should operate according to the provider's
  security policy.
- **Implementation:** Organizational / pipeline concern — the tool only writes a
  file via `--sbom`.

### Explicitly Identifying Unknown Information — ✅ implemented

> When required data is not provided, the SBOM author should explicitly state
> whether it is unknown or intentionally withheld.

- Do not silently omit unavailable required data.
- Distinguish information unknown to the SBOM author from information the author
  knows but withholds from the SBOM.
- Provide a process through which recipients can ask about redacted,
  security-related information.
- An organization may consider an SBOM incomplete when essential component data
  is withheld.
- **Implementation:** No required field is silently omitted. A missing SBOM
  author is recorded as an explicit `Unknown` (with a stderr warning); component
  producer, version, and license likewise fall back to explicit
  `Unknown`/`NOASSERTION` when the pipeline supplies no value and for remote
  imports that cannot be spoken for.

### Frequency — 🚧 partial

> Each software version or update should have an associated SBOM.

- Generate a new SBOM for each new build or release, including builds that
  integrate updated components or dependencies.
- Issue a revised SBOM when new information about underlying components is
  discovered or an error in existing SBOM data is corrected.
- **Implementation:** Each run emits a fresh SBOM (new timestamp + serial
  number), enabling a per-build/per-release SBOM; enforcing that cadence is
  pipeline policy.

### Machine-Processable Data — ✅ implemented

> SBOM implementations should support compatible, automated processing at
> scale.

- Use a machine-processable, interoperable SBOM format. The guidance identifies
  SPDX and CycloneDX as the two formats currently widely used for SBOM
  generation and consumption.
- Component producers and SBOM authors may choose a preferred format based on
  organization-, industry-, or sector-specific factors.
- Support formats that are widely used, open source, and compatible with
  existing data formats, and reassess supported formats regularly.
- Stop using a format when it is broadly incompatible, unmaintained, or
  ineffective for SBOM use cases.
- Organizations consuming SBOMs should accept any widely used, interoperable,
  machine-processable format and should avoid deprecated format versions for
  new software.
- **Implementation:** Output is CycloneDX 1.6 JSON — one of the two formats named
  by the guidance.

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

## Source coverage

- Detailed Data Fields requirements: pages 8-13.
- Practices and Processes requirements: pages 13-14.
- Consolidated list and definitions of the 17 Data Fields: Appendix A, page 19.
