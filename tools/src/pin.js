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
 * Import pinning.
 *
 * Records the sha256 of each imported file back into the importing descriptor's
 * `import.digest` fields, so a later resolution can verify that the bytes it
 * loads are the exact bytes that were pinned. This is an integrity concern, a
 * sibling of the SBOM: it depends only on the loader (to fetch and hash a
 * target's bytes) and knows nothing about schema validity. A target that cannot
 * be loaded — missing, malformed — cannot be pinned, so a pin always names real
 * bytes; whether those bytes are a *correct* descriptor is `validate`'s job.
 *
 * The descriptor is edited through its YAML document, not re-serialized from
 * data, so comments, anchors, and key order survive. Pinning is all-or-nothing:
 * if any import fails to load, the file is left untouched and the failures are
 * reported, so a run never leaves a half-pinned file behind. The digest is over
 * each target's own raw bytes (a shallow, per-file hash); a target's own imports
 * are pinned by running on that file in turn.
 */

'use strict';

const { parseDocument } = require('yaml');
const loader = require('./loader');
const { schemaNameFromUrl, isRemote } = require('./urls');
const { walkableFields, NESTED_FIELDS, isPlainObject, escapeSegment } = require('./shape');

/**
 * @typedef {import('./types').Loader} Loader
 *
 * @typedef {object} PinChange the outcome of pinning one import
 * @property {string} pointer JSON pointer to the `import.digest` that was addressed
 * @property {string|null} url resolved URL of the imported file, or null if it had none
 * @property {string|null} previous the digest previously recorded, or null if none
 * @property {string|null} digest the newly computed base64 sha256, or null if not pinned
 * @property {string|null} error why this import could not be pinned, or null on success
 * @property {boolean} changed whether this pin differs from what was already there
 * @property {boolean} skipped whether this import was left untouched by a scope filter
 *
 * @typedef {object} PinResult
 * @property {string} text the descriptor text after pinning (unchanged if nothing applied)
 * @property {PinChange[]} changes one entry per import found, in document order
 * @property {boolean} changed whether any digest was added or updated
 * @property {boolean} ok whether every import was pinned (no failures)
 */

/** Render a key path as an RFC 6901 JSON pointer. */
function toPointer(path) {
    return path.map((segment) => `/${escapeSegment(segment)}`).join('');
}

/**
 * Guard the write-back step: a pin can only be recorded into a local file,
 * since a remote descriptor has no path on disk to rewrite in place.
 *
 * @param {URL} url the descriptor a caller intends to rewrite
 * @throws {Error} if `url` is not a local `file:` descriptor
 */
function assertWritable(url) {
    if (isRemote(url)) {
        throw new Error('cannot write to a remote descriptor; writing pins requires a local file');
    }
}

/**
 * Collect every `import`-bearing node in a descriptor, with the key path to each.
 * A node may both carry an `import` and nest further param-bearing maps, so both
 * are always examined. Only the maps a node can legally contain are descended
 * (`params` everywhere, plus `commands` at a device root), matching the walk the
 * resolver uses.
 *
 * @param {unknown} node the node to inspect
 * @param {string[]} fields the param-bearing maps to descend at this level
 * @param {Array<string>} path the key path to `node`
 * @param {Array<{path: string[], directive: object}>} out collected imports
 */
function collectImports(node, fields, path, out) {
    if (!isPlainObject(node)) {
        return;
    }
    if (isPlainObject(node.import)) {
        out.push({ path, directive: node.import });
    }
    for (const field of fields) {
        const map = node[field];
        if (!isPlainObject(map)) {
            continue;
        }
        for (const key of Object.keys(map)) {
            collectImports(map[key], NESTED_FIELDS, [...path, field, key], out);
        }
    }
}

/**
 * Compute the digest of every import target in a descriptor and write it into
 * the descriptor's `import.digest` fields.
 *
 * @param {URL} url location of the descriptor to pin
 * @param {object} [options]
 * @param {Loader} [options.load] custom transport; defaults to the loader's own
 * @param {boolean} [options.includeLocal] also pin local (`file:`) imports; by
 *   default only remote imports are pinned and local ones are reported as skipped
 * @returns {Promise<PinResult>}
 * @throws {LoadError} if the descriptor itself will not load or parse
 */
async function pin(url, { load = loader.defaultLoad, includeLocal = false } = {}) {
    let raw;
    try {
        raw = await load(url);
    } catch (err) {
        throw new loader.LoadError(err.message, { cause: err });
    }

    const doc = parseDocument(raw);
    if (doc.errors.length > 0) {
        throw new loader.LoadError(`Invalid YAML in ${url.pathname}: ${doc.errors[0].message}`, { cause: doc.errors[0] });
    }

    const imports = [];
    collectImports(doc.toJS(), walkableFields(schemaNameFromUrl(url)), [], imports);

    const changes = [];
    for (const { path, directive } of imports) {
        const pointer = toPointer([...path, 'import', 'digest']);
        const previous = directive.digest ?? null;

        if (typeof directive.url !== 'string') {
            changes.push({ pointer, url: null, previous, digest: null, error: 'import is missing its url', changed: false, skipped: false });
            continue;
        }

        const targetUrl = new URL(directive.url, url);
        if (!includeLocal && !isRemote(targetUrl)) {
            changes.push({ pointer, url: targetUrl.href, previous, digest: null, error: null, changed: false, skipped: true });
            continue;
        }

        try {
            const { digest } = await loader.loadDescriptor(targetUrl, { load });
            changes.push({ pointer, url: targetUrl.href, previous, digest, error: null, changed: previous !== digest, skipped: false, path });
        } catch (err) {
            if (!(err instanceof loader.LoadError)) {
                throw err;
            }
            changes.push({ pointer, url: targetUrl.href, previous, digest: null, error: err.message, changed: false, skipped: false });
        }
    }

    const ok = changes.every((change) => !change.error);
    let changed = false;
    if (ok) {
        for (const change of changes) {
            if (!change.changed) {
                continue;
            }
            doc.setIn([...change.path, 'import', 'digest'], change.digest);
            changed = true;
        }
    }

    return {
        text: changed ? doc.toString() : raw,
        changes: changes.map(({ path: _path, ...change }) => change),
        changed,
        ok,
    };
}

module.exports = { pin, assertWritable };
