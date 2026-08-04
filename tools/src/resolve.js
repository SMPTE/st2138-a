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
 * node supplies local overrides; the imported file supplies the base. This
 * module owns the merge policy; transport, integrity, and parsing stay in the
 * loader, and validation stays in the engine.
 *
 * Every fragment is validated twice: once "before" the merge, as authored,
 * against its own source map (so its errors carry real line numbers), and once
 * "after", when the fully merged tree is checked as a whole to catch problems
 * that only emerge from the merge. Because an import stub is itself a valid
 * param, each file validates cleanly on its own terms, and this holds at every
 * level of an import chain. A descriptor with no imports is validated once.
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
const { emptySourceMap } = require('./sourcemap');
const { schemaNameFromUrl } = require('./urls');
const { NESTED_FIELDS, walkableFields, isPlainObject, escapeSegment } = require('./shape');
const { ERROR } = require('./checks/constants');

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
 * @property {boolean} imported whether any import directive was inlined
 * @property {ImportRecord[]} imports every file inlined in this subtree, in DFS order
 * @property {string[]} directImports resolved URLs the current file imports directly,
 *   its own edges in the dependency graph (reset at each file boundary)
 * @property {string} [digest] base64 sha256 of this file's loaded bytes; set only by resolveFile
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
    return { data: {}, diagnostics: [diagnostic], valid: false, imported: true, imports: [], directImports: [] };
}

/**
 * Deep-merge an imported base with a local override, local winning on
 * collisions. Mappings (e.g. `help`, nested `params`) merge key-by-key so keys
 * present in only one side survive; scalars and arrays are replaced wholesale
 * by the local value. Neither input is mutated.
 *
 * @param {unknown} base value supplied by the imported file
 * @param {unknown} local value supplied by the importing node (wins)
 * @returns {unknown} merged result
 */
function mergeImported(base, local) {
    if (!isPlainObject(base) || !isPlainObject(local)) {
        return local;
    }

    const result = { ...base };
    for (const key of Object.keys(local)) {
        result[key] = mergeImported(base[key], local[key]);
    }
    return result;
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
    let imported = false;

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
            imported = imported || child.imported;
        }
        result[field] = map;
    }

    return { data: result, diagnostics, valid, imported, imports, directImports };
}

/**
 * Resolve a single node: inline its own `import` (if any), then recurse into
 * its param-bearing children.
 *
 * When the node carries `import: { url, digest? }`, the referenced file is the
 * base and the node's other keys are local overrides (deep merge, local wins,
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

    const overrides = await resolveChildren(local, source, deps, NESTED_FIELDS, pointer);

    // This import, then the files it pulled in, then those the overrides pull in.
    // The digest is the hash of what was actually loaded, from the imported file;
    // the record's dependencies are the files that imported file itself imports.
    const record = { url: importUrl.href, digest: imported.digest, dependencies: imported.directImports };

    return {
        data: mergeImported(imported.data, overrides.data),
        diagnostics: [...imported.diagnostics, ...overrides.diagnostics],
        valid: imported.valid && overrides.valid,
        imported: true,
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
        return { data: before.data, diagnostics: before.diagnostics, valid: false, imported: false, imports: [], directImports: [], digest: loadedDigest };
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
        imported: resolved.imported,
        imports: resolved.imports,
        directImports: resolved.directImports,
        digest: loadedDigest
    };
}

/**
 * Resolve a descriptor's imports into a single self-contained tree.
 *
 * Each fragment is validated "before" the merge, as authored, against its own
 * source map (real line numbers). If any import was inlined and every fragment
 * was individually sound, the merged tree gets one final "after" pass to catch
 * problems that only emerge from the merge; this pass spans files, so it carries
 * no line info. A descriptor with no imports — or one whose fragments already
 * failed on their own — is not re-validated: there is nothing a merged pass
 * could add but duplicate, line-less diagnostics.
 *
 * @param {URL} url location of the descriptor to resolve
 * @param {object} deps
 * @param {ValidateFn} deps.validate validates data against a named schema
 * @param {Loader} [deps.load] custom transport, forwarded to the loader
 * @param {string|null} [deps.digest] base64 sha256 to pin the root file against
 * @returns {Promise<ResolutionResult>}
 */
async function resolve(url, { validate, load, digest = null }) {
    const deps = { validate, load };
    const resolved = await resolveFile(url, deps, digest);
    const imports = dedupeImports(resolved.imports);
    // The root's own edges in the dependency graph: the files it imports directly.
    const dependencies = resolved.directImports;

    if (!resolved.imported || !resolved.valid) {
        return { data: resolved.data, diagnostics: resolved.diagnostics, valid: resolved.valid, imports, dependencies, digest: resolved.digest };
    }

    const after = validate(schemaNameFromUrl(url), resolved.data, emptySourceMap);
    // Return the tree we just checked, not `after.data`: the after-pass diagnostics
    // point into this tree, so callers need it to resolve their paths.
    return {
        data: resolved.data,
        diagnostics: [...resolved.diagnostics, ...after.diagnostics],
        valid: after.valid,
        imports,
        dependencies,
        digest: resolved.digest
    };
}

module.exports = { mergeImported, resolve };
