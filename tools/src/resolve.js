/*
 * Copyright © MMXXVI 2026 by the Society of Motion Picture and Television Engineers
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation and/or
 *    other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
 * ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/*
 * Import resolution.
 *
 * Builds a single self-contained descriptor from one that uses `import`
 * directives to pull in parameter definitions from other files. The importing
 * node supplies local overrides; the imported file supplies the base, combined
 * by the shared shallow merge rule (`shape.shallowMerge`) so an import and a
 * template specialize a node the same way; transport, integrity, and parsing
 * stay in the loader, and validation stays in the engine.
 *
 * Each fragment is validated as authored, against its own source map (so its
 * errors carry real line numbers), running only the gate-phase checks (schema,
 * digest) the resolver depends on to descend and load safely. Because an import
 * stub is itself a valid param, each file validates cleanly on its own terms,
 * and this holds at every level of an import chain. Once the tree is fully
 * inlined and its templates expanded, the report-phase checks run once over the
 * whole model against the root file's line map — nodes pulled in from imported
 * files resolve to no line, everything authored in the root keeps its lines.
 *
 * A fragment that is invalid as authored is never descended: its structure is
 * exactly what the schema just rejected — an `import` may lack its `url`, a
 * `params` may not be a map — so resolution stops there and reports only that
 * fragment's own diagnostics rather than acting on shapes it cannot trust.
 *
 * An import that cannot be loaded at all — a missing file, a digest that does
 * not match, text that will not parse — is likewise not descended: the failure
 * is reported as an error diagnostic located at the `import` in the importing
 * file, and that subtree stops, so one unreachable import does not abort the
 * whole resolution.
 *
 * Every file actually inlined is recorded as provenance — its resolved URL, the
 * sha256 of the bytes actually loaded, and the URLs it imports directly — and
 * returned as a list deduped by URL, so a file reached along two branches counts
 * once while its edges are preserved. This is the raw material for a later SBOM
 * and its dependency graph.
 */

'use strict';

const loader = require('./loader');
const { schemaNameFromUrl } = require('./urls');
const { NESTED_FIELDS, walkableFields, isPlainObject, shallowMerge, escapeSegment, unescapeSegment } = require('./shape');
const { ERROR } = require('./checks/constants');
const { expandTemplates, rebaseTemplates } = require('./templates');

/**
 * @typedef {import('./types').ValidationResult} ValidationResult
 * @typedef {import('./types').ResolutionResult} ResolutionResult
 * @typedef {import('./types').ImportRecord} ImportRecord
 * @typedef {import('./types').Diagnostic} Diagnostic
 * @typedef {import('./types').Loader} Loader
 * @typedef {import('./sourcemap').SourceMap} SourceMap
 *
 * @callback ValidateFn
 * @param {string} schemaName
 * @param {unknown} data
 * @param {SourceMap} sourceMap
 * @returns {ValidationResult}
 *
 * @typedef {object} Source the file a node was authored in, and the path to it
 * @property {URL} url the file's location, the base for its relative imports
 * @property {SourceMap} sourceMap resolves pointers to lines in that same file
 * @property {string[]} ancestors hrefs of the files open on the path to this one,
 *   this file included, so an import back onto any of them is caught as a cycle
 */

/**
 * @typedef {object} ResolvedTree the result of inlining a subtree's imports
 * @property {object} data the resolved, import-free data
 * @property {Diagnostic[]} diagnostics accumulated "before" (as-authored) diagnostics
 * @property {boolean} valid whether every as-authored validation passed
 * @property {ImportRecord[]} imports every file inlined in this subtree, in DFS order
 * @property {string[]} directImports resolved URLs the current file imports directly,
 *   its own edges in the dependency graph (reset at each file boundary)
 * @property {string} [digest] base64 sha256 of this file's loaded bytes; set only by resolveFile
 * @property {SourceMap} [sourceMap] this file's line map; set only by resolveFile, used for the final pass
 */

/**
 * Collapse imports of the same file to one record, keeping first-seen order.
 * A diamond reaches a single file along two branches; an SBOM lists it once.
 * @param {ImportRecord[]} imports
 * @returns {ImportRecord[]}
 */
function dedupeImports(imports) {
    const seen = new Set();
    const unique = [];
    for (const record of imports) {
        if (seen.has(record.url)) {
            continue;
        }
        seen.add(record.url);
        unique.push(record);
    }
    return unique;
}

/**
 * Recast a load failure as a stop-here result. The node's bytes could not be
 * materialized — the file is missing, its digest did not match, or it would not
 * parse — so it contributes an error diagnostic located at the offending
 * `import` in the *importing* file and nothing to merge. This mirrors the
 * before-validate gate (emit, don't descend, mark invalid), so one unreachable
 * import surfaces as a located error rather than aborting the whole resolution.
 *
 * @param {SourceMap} sourceMap the importing file's source map
 * @param {string} pointer JSON pointer to the offending `import` node
 * @param {string} message the load failure's description
 * @returns {ResolvedTree}
 */
function importFailure(sourceMap, pointer, message) {
    const diagnostic = { level: ERROR, message, instancePath: pointer, lines: sourceMap.linesFor(pointer) };
    return { data: {}, diagnostics: [diagnostic], valid: false, imports: [], directImports: [] };
}

/**
 * The FQOID of the node at `pointer` — its param path from the file root, the
 * prefix an imported fragment's internal template references shift by when
 * mounted here. The pointer alternates field and key segments
 * (`/params/a/params/b`); its keys, unescaped and rejoined, are the FQOID
 * (`a/b`). An import at the file root has pointer '' and thus no prefix — the
 * outer import that pulls this file in supplies the shift.
 * @param {string} pointer JSON pointer to the mount node within its file
 * @returns {string}
 */
function mountFqoid(pointer) {
    const segments = pointer.split('/').slice(1);
    const keys = [];
    for (let i = 1; i < segments.length; i += 2) {
        keys.push(unescapeSegment(segments[i]));
    }
    return keys.join('/');
}

/**
 * Recurse into a node's param-bearing maps, resolving each child in place. The
 * child maps to descend are given by `fields`: the device root passes
 * `ROOT_FIELDS` (`params` + `commands`); every deeper level passes
 * `NESTED_FIELDS` (`params` only), since `commands` never nests. Structural
 * nesting alone touches no I/O — only an actual `import` directive loads a
 * file. The node is shallow-cloned per level, so no input is mutated.
 *
 * @param {object} node a param-shaped node or the device root
 * @param {Source} source the file this node was authored in (base + line info)
 * @param {{ validate: ValidateFn, load?: Loader }} deps
 * @param {string[]} fields which child maps to descend at this level
 * @param {string} pointer JSON pointer to this node within its file
 * @returns {Promise<ResolvedTree>}
 */
async function resolveChildren(node, source, deps, fields, pointer) {
    const result = { ...node };
    const diagnostics = [];
    const imports = [];
    const directImports = [];
    let valid = true;

    for (const field of fields) {
        if (!isPlainObject(result[field])) {
            continue;
        }
        const map = { ...result[field] };
        for (const key of Object.keys(map)) {
            const childPointer = `${pointer}/${field}/${escapeSegment(key)}`;
            const child = await resolveNode(map[key], source, deps, NESTED_FIELDS, childPointer);
            map[key] = child.data;
            diagnostics.push(...child.diagnostics);
            imports.push(...child.imports);
            directImports.push(...child.directImports);
            valid = valid && child.valid;
        }
        result[field] = map;
    }

    return { data: result, diagnostics, valid, imports, directImports };
}

/**
 * Resolve a single node: inline its own `import` (if any), then recurse into
 * its param-bearing children.
 *
 * When the node carries `import: { url, digest? }`, the referenced file is the
 * base and the node's other keys are local overrides (shallow merge, local wins,
 * `import` dropped). Each side is resolved against its own location first — the
 * imported file relative to its own URL, the overrides relative to this file —
 * so relative imports nested within either side resolve correctly, and only
 * then are the two resolved trees merged.
 *
 * If the imported file cannot be loaded — missing, integrity failure, malformed
 * — the failure is recast as a located diagnostic at this node's `import` (in
 * this file) and the subtree stops there; the bytes simply do not exist to
 * merge. An import that points back at a file already open on the path to this
 * one is a cycle: it is reported the same way and not followed, so resolution
 * terminates instead of looping. Any other error is a genuine fault and
 * propagates.
 *
 * `node` is always a mapping: every entry into resolution is gated by the
 * file's before-validation, so by the time a node is descended its shape has
 * already been accepted by the schema and can be trusted.
 *
 * @param {object} node a validated node — the descriptor root or a nested param/command
 * @param {Source} source the file this node was authored in (base + line info)
 * @param {{ validate: ValidateFn, load?: Loader }} deps
 * @param {string[]} fields which child maps to descend (root vs nested)
 * @param {string} pointer JSON pointer to this node within its file
 * @returns {Promise<ResolvedTree>}
 */
async function resolveNode(node, source, deps, fields, pointer) {
    if (!('import' in node)) {
        return resolveChildren(node, source, deps, fields, pointer);
    }

    // A node carrying `import` is a param or command, never the device root, so
    // its overrides descend the nested fields regardless of `fields`.
    const { import: directive, ...local } = node;
    const importUrl = new URL(directive.url, source.url);

    if (source.ancestors.includes(importUrl.href)) {
        return importFailure(source.sourceMap, `${pointer}/import`, `Import cycle: ${importUrl} is already being resolved`);
    }

    let imported;
    try {
        imported = await resolveFile(importUrl, deps, directive.digest, source.ancestors);
    } catch (err) {
        if (err instanceof loader.LoadError) {
            return importFailure(source.sourceMap, `${pointer}/import`, err.message);
        }
        throw err;
    }

    // The imported fragment writes its template references relative to its own
    // root; mounting it at this node shifts them all by this node's path, so a
    // shared library's internal references resolve wherever the library lands.
    rebaseTemplates(imported.data, mountFqoid(pointer));

    const overrides = await resolveChildren(local, source, deps, NESTED_FIELDS, pointer);

    // This import, then the files it pulled in, then those the overrides pull in.
    // The digest is the hash of what was actually loaded, from the imported file;
    // the record's dependencies are the files that imported file itself imports.
    const record = { url: importUrl.href, digest: imported.digest, dependencies: imported.directImports };

    return {
        data: shallowMerge(imported.data, overrides.data),
        diagnostics: [...imported.diagnostics, ...overrides.diagnostics],
        valid: imported.valid && overrides.valid,
        imports: [record, ...imported.imports, ...overrides.imports],
        directImports: [importUrl.href, ...overrides.directImports]
    };
}

/**
 * Load a descriptor and validate it as authored — the "before" pass. Because
 * the file is validated against its own source map, its errors report real line
 * numbers, and because an import stub is a valid param, the file passes on its
 * own terms even when it defers definitions to other files. Any imports it
 * contains are then inlined. The maps to descend are derived from the file's
 * own schema type, so a device, a param, or a command each walk correctly.
 *
 * If that pass fails, the file's shape can't be trusted — an `import` might
 * lack its `url`, a `params` might not be a map — so resolution stops here
 * rather than descending into structures the schema just rejected.
 *
 * @param {URL} url location of the descriptor to load
 * @param {{ validate: ValidateFn, load?: Loader }} deps
 * @param {string|null} digest base64 sha256 to verify the loaded file against, or null
 * @param {string[]} [ancestors] hrefs of the files already open on the path here,
 *   used to catch an import that cycles back onto one of them
 * @returns {Promise<ResolvedTree>}
 */
async function resolveFile(url, deps, digest, ancestors = []) {
    const { data, sourceMap, digest: loadedDigest } = await loader.loadDescriptor(url, { digest, load: deps.load });
    const schemaName = schemaNameFromUrl(url);
    const before = deps.validate(schemaName, data, sourceMap);
    if (!before.valid) {
        // Hand back the validation result's data ({} on failure), never the raw
        // parse, so an invalid fragment splices nothing unvalidated into a merge.
        return { data: before.data, diagnostics: before.diagnostics, valid: false, imports: [], directImports: [], digest: loadedDigest, sourceMap };
    }
    // Past the gate `before.data` is the validated model — a plain object, not
    // the scalar/array/null a well-formed file could still parse to — so descend
    // that rather than the loader's `unknown` and let the walk trust its footing.
    const source = { url, sourceMap, ancestors: [...ancestors, url.href] };
    const resolved = await resolveNode(before.data, source, deps, walkableFields(schemaName), '');

    return {
        data: resolved.data,
        diagnostics: [...before.diagnostics, ...resolved.diagnostics],
        valid: resolved.valid,
        imports: resolved.imports,
        directImports: resolved.directImports,
        digest: loadedDigest,
        sourceMap
    };
}

/**
 * Resolve a descriptor's imports into a single self-contained tree, then expand
 * its templates into the runtime model it describes.
 *
 * Each fragment is validated as authored, against its own source map (real line
 * numbers), running only the gate-phase checks the resolver depends on. Once the
 * tree is fully inlined and its templates expanded, the report-phase checks run
 * once over the whole model via `validateFinal`, against the root file's line
 * map: nodes authored in the root keep their lines, nodes pulled in from imported
 * files resolve to none. This final pass also re-checks the assembled structure,
 * catching problems that only emerge from the merge or from expansion.
 *
 * A tree that survives resolution has its `template_oid` references expanded, so
 * each consumer carries the shape it borrowed and `data` is the runtime model.
 * The template sources and the `template_oid` provenance stay in the tree.
 * Expansion acts on whatever `params` a descriptor carries, so a device, a
 * `param`, or a `command` all expand; a descriptor with no params, or a param
 * tree with nothing to expand, passes through unchanged. A template that does
 * not resolve is a hard error: the model would be ill-defined, so the
 * pre-expansion tree is returned, marked invalid. Passing
 * `disableTemplateExpansion` skips this step and runs the final pass over the
 * merged tree with its `template_oid` references left as authored.
 *
 * @param {URL} url location of the descriptor to resolve
 * @param {object} deps
 * @param {ValidateFn} deps.validate validates a fragment (gate-phase checks)
 * @param {ValidateFn} [deps.validateFinal] validates the resolved model (report-phase
 *   checks); defaults to `validate` when a caller does not distinguish the phases
 * @param {Loader} [deps.load] custom transport, forwarded to the loader
 * @param {string|null} [deps.digest] base64 sha256 to pin the root file against
 * @param {boolean} [deps.disableTemplateExpansion] return the merged tree without expanding templates
 * @returns {Promise<ResolutionResult>}
 */
async function resolve(url, { validate, validateFinal = validate, load, digest = null, disableTemplateExpansion = false }) {
    const deps = { validate, load };
    const resolved = await resolveFile(url, deps, digest);
    const imports = dedupeImports(resolved.imports);
    // The root's own edges in the dependency graph: the files it imports directly.
    const dependencies = resolved.directImports;
    const schemaName = schemaNameFromUrl(url);
    const diagnostics = [...resolved.diagnostics];

    // A fragment invalid as authored is not merged or expanded: its shape is
    // exactly what the schema just rejected, so there is nothing to act on.
    if (!resolved.valid) {
        return { data: resolved.data, diagnostics, valid: false, imports, dependencies, digest: resolved.digest };
    }

    // Expand before the final pass, so the report checks see the runtime model.
    let tree = resolved.data;
    if (!disableTemplateExpansion) {
        const expanded = expandTemplates(tree);
        diagnostics.push(...expanded.diagnostics);
        // An unresolved or cyclic template leaves the model ill-defined: report it
        // and hand back the pre-expansion tree rather than a half-expanded one.
        if (!expanded.valid) {
            return { data: tree, diagnostics, valid: false, imports, dependencies, digest: resolved.digest };
        }
        tree = expanded.data;
    }

    // The report-phase checks (and a whole-tree structural re-check) run once
    // here, on the fully resolved and expanded model, against the root's lines.
    const final = validateFinal(schemaName, tree, resolved.sourceMap);
    diagnostics.push(...final.diagnostics);
    return { data: tree, diagnostics, valid: final.valid, imports, dependencies, digest: resolved.digest };
}

module.exports = { resolve };
