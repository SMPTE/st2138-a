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
 * The descriptor is edited through its concrete syntax tree (CST), rewriting
 * only the `import.digest` tokens and leaving every other byte — comments,
 * anchors, key order, indentation, and quoting — exactly as written. Because
 * nothing is re-serialized from the data model, a JSON descriptor stays JSON
 * (and stays formatted the way its author left it) rather than being reflowed
 * as YAML. Pinning is all-or-nothing: if any import fails to load, the file is
 * left untouched and the failures are reported, so a run never leaves a
 * half-pinned file behind. The digest is over each target's own raw bytes (a
 * shallow, per-file hash); a target's own imports are pinned by running on that
 * file in turn.
 */

'use strict';

const { Parser, Composer, CST } = require('yaml');
const loader = require('./loader');
const { schemaNameFromUrl, isRemote } = require('./urls');
const { collectImports, toPointer } = require('./shape');

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
 * Record `digest` into the `import.digest` at `importPath`, editing the CST in
 * place. An existing digest scalar is overwritten while keeping its own token
 * type (a JSON descriptor's stays double-quoted, a YAML one's stays plain); a
 * missing one is inserted as a new entry into the import map. Both touch only
 * the affected tokens, so the rest of the file survives byte-for-byte.
 *
 * @param {import('yaml').Document} doc the composed descriptor (source tokens kept)
 * @param {(string|number)[]} importPath path to the import map holding the digest
 * @param {string} digest base64 sha256 to record
 */
function writeDigest(doc, importPath, digest) {
    const existing = doc.getIn([...importPath, 'digest'], true);
    if (existing && existing.srcToken && CST.isScalar(existing.srcToken)) {
        CST.setScalarValue(existing.srcToken, digest);
        return;
    }
    insertDigest(doc.getIn(importPath, true).srcToken, digest);
}

/**
 * Append a `digest: <value>` entry to an import map's CST collection token,
 * mirroring the separators of the entry already present (the import's `url`, which
 * a missing-url import never reaches here). Flow collections (JSON) get a
 * comma-led, double-quoted entry; block maps (YAML) get an indented plain entry.
 * Whitespace tokens are cloned from the map's existing entry so indentation and
 * line style match, whether the source is multi-line or a single line.
 *
 * @param {object} collection the `flow-collection` or `block-map` CST token
 * @param {string} digest the value to store
 */
function insertDigest(collection, digest) {
    const inFlow = collection.type === 'flow-collection';
    const items = collection.items;
    let prevIdx = -1;
    for (let i = 0; i < items.length; i++) {
        if (items[i].key) {
            prevIdx = i;
        }
    }
    const prev = items[prevIdx];
    const indent = prev.key.indent;
    const scalarType = inFlow ? 'double-quoted-scalar' : 'scalar';
    const clone = (token) => ({ ...token });

    const entry = {
        key: { type: scalarType, indent, source: inFlow ? '"digest"' : 'digest' },
        sep: [
            { type: 'map-value-ind', indent, source: ':' },
            { type: 'space', indent, source: ' ' },
        ],
        value: { type: scalarType, indent, source: inFlow ? JSON.stringify(digest) : digest },
    };

    if (inFlow) {
        // The whitespace before the closing bracket becomes the whitespace
        // before the closing bracket again — just after the new entry now.
        const preClose = [...(prev.value.end ?? []), ...items.slice(prevIdx + 1).flatMap((item) => item.start)];
        const newline = preClose.find((token) => token.type === 'newline');
        const entryIndent = prev.start.find((token) => token.type === 'space');
        const separator = newline
            ? [clone(newline), entryIndent ? clone(entryIndent) : { type: 'space', indent, source: ' '.repeat(indent) }]
            : [{ type: 'space', indent, source: ' ' }];
        entry.start = [{ type: 'comma', indent, source: ',' }, ...separator];
        entry.value.end = preClose.map(clone);
        prev.value.end = [];
        items.splice(prevIdx + 1, items.length - (prevIdx + 1), entry);
    } else {
        // A block entry sits on its own line: the previous value must end in a
        // newline, and the new value carries one only if the file was newline-terminated.
        const prevEnd = prev.value.end ?? [];
        const terminated = prevEnd.some((token) => token.type === 'newline');
        if (!terminated) {
            prev.value.end = [...prevEnd, { type: 'newline', indent, source: '\n' }];
        }
        entry.start = [{ type: 'space', indent, source: ' '.repeat(indent) }];
        entry.value.end = terminated ? [{ type: 'newline', indent, source: '\n' }] : [];
        items.push(entry);
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

    // The loader hands back raw bytes; decode to parse and to echo the file
    // unchanged. `toString('utf8')` keeps a leading BOM intact so the untouched
    // passthrough stays byte-faithful.
    const text = raw.toString('utf8');

    // Parse to the CST token stream (kept for a byte-faithful re-stringify) and
    // compose it into a Document (navigated to locate each digest node). The two
    // share their source tokens, so an edit made through the Document's
    // `srcToken` shows up when the tokens are stringified back out.
    const tokens = [...new Parser().parse(text)];
    const doc = [...new Composer({ keepSourceTokens: true }).compose(tokens)][0];
    if (!doc || doc.errors.length > 0) {
        const cause = doc && doc.errors[0];
        throw new loader.LoadError(`Invalid YAML in ${url.pathname}: ${cause ? cause.message : 'empty document'}`, { cause });
    }

    const imports = collectImports(doc.toJS(), schemaNameFromUrl(url));

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
            writeDigest(doc, [...change.path, 'import'], change.digest);
            changed = true;
        }
    }

    return {
        text: changed ? tokens.map((token) => CST.stringify(token)).join('') : text,
        changes: changes.map(({ path: _path, ...change }) => change),
        changed,
        ok,
    };
}

module.exports = { pin, assertWritable };
