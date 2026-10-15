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
 * Descriptor loading.
 *
 * Splits the "get a descriptor into memory" concern out of the validation
 * engine. Transport (reading bytes) is pluggable via a `load` function so
 * callers can supply their own fetcher (caching, auth, in-memory fixtures) and
 * tests can shim it without touching the filesystem or network. Integrity
 * (sha256 digest) and parsing stay here, in the engine's trust boundary, so a
 * custom loader can only change *how bytes are obtained*, never whether they
 * are verified.
 */

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sourcemap = require('./sourcemap');
const { computeDigest, digestsMatch } = require('./digest');
const { parseProvenance } = require('./provenance');

/**
 * @typedef {import('./types').Loader} Loader
 * @typedef {import('./sourcemap').SourceMap} SourceMap
 */

/**
 * A descriptor that could not be materialized: its bytes could not be obtained
 * (missing file, failed fetch), failed their integrity check (digest mismatch),
 * or could not be parsed (malformed JSON/YAML). This is categorically distinct
 * from a descriptor that loads fine but is *wrong* (a schema violation) — the
 * node simply does not exist to validate. Typed so the resolver can catch it
 * selectively and turn an import that fails to load into a located diagnostic,
 * while letting any other (unexpected) error propagate as a real fault.
 */
class LoadError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'LoadError';
    }
}

/**
 * Default transport: read `file:` URLs from disk, otherwise fetch over the
 * network. Returns the raw bytes verbatim — no decoding — so {@link
 * loadDescriptor} can hash exactly what was fetched; verification and parsing
 * happen there.
 * @type {Loader}
 * @param {URL} url location to read
 * @returns {Promise<Buffer>} raw descriptor bytes
 * @throws {Error} if the file cannot be opened or the fetch fails
 */
async function defaultLoad(url) {
    if (url.protocol === 'file:') {
        try {
            return await fs.readFile(url);
        } catch {
            throw new Error(`Cannot open file at ${url.pathname}`);
        }
    }

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

/**
 * Load, verify, and parse a descriptor into an object plus a source map for
 * resolving line numbers in the original text. Parsing always runs through the
 * YAML engine (JSON is a YAML subset). A `.json` extension additionally gates
 * the text through strict `JSON.parse`, rejecting YAML-isms (comments,
 * unquoted keys, ...) so a `.json` descriptor stays portable to strict JSON
 * consumers.
 *
 * @param {URL} url location of the descriptor to load
 * @param {object} [opts]
 * @param {string} [opts.digest] base64 sha256 digest to verify the loaded bytes against
 * @param {Loader} [opts.load] custom transport; defaults to {@link defaultLoad}
 * @returns {Promise<{data: unknown, sourceMap: SourceMap, digest: string, provenance: object}>}
 *   parsed data, its source map, the base64 sha256 of the bytes actually loaded,
 *   and the provenance the descriptor declares about itself in its leading comments
 * @throws {LoadError} if loading fails, the digest does not match, or the text is malformed
 */
async function loadDescriptor(url, { digest = null, load = defaultLoad } = {}) {
    let bytes;
    try {
        bytes = await load(url);
    } catch (err) {
        // Transport failure (missing file, failed fetch): normalize whatever the
        // loader threw so the resolver sees one recognizable load-failure type.
        throw new LoadError(err.message, { cause: err });
    }

    // Hash the bytes exactly as loaded — never a decoded copy — so the digest is
    // the sha256 of what was actually fetched, matching openssl/sha256sum and the
    // value an `import` pins against. Reported for every load, pinned or not.
    const computed = computeDigest(bytes);
    if (digest && !digestsMatch(digest, computed)) {
        throw new LoadError(`Digest mismatch for ${url}: expected ${digest}, got ${computed}`);
    }

    // Decode only now, to parse. TextDecoder drops a leading UTF-8 BOM (which
    // stays in the hashed bytes above) so a BOM-prefixed descriptor still parses.
    const text = new TextDecoder().decode(bytes);

    const ext = path.extname(url.pathname).toLowerCase();
    if (ext === '.json') {
        // JSON descriptors must be strict JSON; reject YAML-isms (comments,
        // unquoted keys, ...) that other JSON tools would refuse.
        try {
            JSON.parse(text);
        } catch (err) {
            throw new LoadError(`Invalid JSON in ${url.pathname}: ${err.message}`);
        }
    }

    try {
        return { ...sourcemap.parse(text), digest: computed, provenance: parseProvenance(text) };
    } catch (err) {
        throw new LoadError(`Invalid YAML in ${url.pathname}: ${err.message}`);
    }
}

module.exports = { defaultLoad, loadDescriptor, LoadError };
