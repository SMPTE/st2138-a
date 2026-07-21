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
 * Internal URL helpers.
 *
 * These are not part of the package's public surface: `validate` coalesces
 * path/URL inputs on its own, so consumers never need them. They exist to
 * support the CLI, which resolves the input into a URL and schema name for its
 * informational output.
 */

'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * Convert a path or URL into a URL the engine understands.
 * @param {string|URL} input
 * @returns {URL}
 */
function toUrl(input) {
    if (input instanceof URL) return input;
    if (typeof input === 'string' && input.indexOf('://') === -1) {
        return pathToFileURL(path.resolve(input));
    }
    return new URL(input);
}

/**
 * Derive the schema name from a descriptor filename, e.g. `device.example.yaml`
 * -> `device`.
 * @param {URL} url
 * @returns {string}
 */
function schemaNameFromUrl(url) {
    return path.parse(url.pathname).name.split('.')[0];
}

module.exports = { toUrl, schemaNameFromUrl };
