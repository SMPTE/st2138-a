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

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const jsonMap = require('json-source-map');
const yaml = require('yaml');

/**
 * @typedef {import('./types').Loader} Loader
 */

/**
 * Default transport: read `file:` URLs from disk, otherwise fetch over the
 * network. Returns the raw text; verification and parsing happen in
 * {@link loadDescriptor}.
 * @type {Loader}
 * @param {URL} url location to read
 * @returns {Promise<string>} raw descriptor text
 * @throws {Error} if the file cannot be opened or the fetch fails
 */
async function defaultLoad(url) {
    if (url.protocol === 'file:') {
        try {
            return await fs.readFile(url, 'utf8');
        } catch {
            throw new Error(`Cannot open file at ${url.pathname}`);
        }
    }

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    }
    return response.text();
}

/**
 * Load, verify, and parse a descriptor into an object plus a source map for
 * resolving line numbers. The format (YAML vs JSON) is chosen from the URL's
 * file extension.
 *
 * @param {URL} url location of the descriptor to load
 * @param {object} [opts]
 * @param {string} [opts.digest] sha256 digest to verify the loaded bytes against
 * @param {Loader} [opts.load] custom transport; defaults to {@link defaultLoad}
 * @returns {Promise<{data: object, sourceMap: object}>} parsed data and source map
 * @throws {Error} if loading fails or the digest does not match
 */
async function loadDescriptor(url, { digest = null, load = defaultLoad } = {}) {
    const raw = await load(url);

    if (digest) {
        const hash = crypto.createHash('sha256').update(raw).digest('hex');
        if (hash !== digest) {
            throw new Error(`Digest mismatch for ${url}: expected ${digest}, got ${hash}`);
        }
    }

    const ext = path.extname(url.pathname).toLowerCase();
    const data = ext === '.yaml' || ext === '.yml' ? yaml.parse(raw) : JSON.parse(raw);

    return {
        data,
        sourceMap: jsonMap.stringify(data, null, 2)
    };
}

module.exports = { defaultLoad, loadDescriptor };
