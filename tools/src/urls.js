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
 * URL helpers.
 *
 * Most are internal: `validate` coalesces path/URL inputs on its own, so
 * consumers never need them; they support the CLI, which resolves the input
 * into a URL and schema name for its informational output.
 * `descriptorIdFromUrl` is the exception — it is re-exported as public API for
 * callers that need a descriptor's kind/name/format without resolving it.
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
 * Decompose a descriptor filename into its identity: schema kind, name, and
 * serialization format, e.g. `device.example.yaml` ->
 * `{ kind: 'device', name: 'example', format: 'yaml' }`.
 * The three-part `<kind>.<name>.<ext>` form is required: a stem with too few or
 * too many dot-separated segments is malformed and throws, so a kind is never
 * guessed from an ambiguous name.
 * @param {string|URL} input
 * @returns {{ kind: string, name: string, format: string }}
 * @throws {Error} when the filename is not `<kind>.<name>.<ext>`
 */
function descriptorIdFromUrl(input) {
    const parsed = path.parse(toUrl(input).pathname);
    // feed through decodeURIComponent to handle escaped characters that were
    // just escaped in toUrl()
    const segments = decodeURIComponent(parsed.name).split('.');
    if (segments.length !== 2) {
        throw new Error(`Descriptor filename must be <kind>.<name>.<ext> (e.g. device.example.yaml), got '${parsed.base}'`);
    }
    const [kind, name] = segments;
    const format = parsed.ext.replace(/^\./, '').toLowerCase();
    if (kind.length === 0) {
        throw new Error(`Descriptor filename must have a non-empty kind: '${parsed.base}'`);
    }
    if (name.length === 0) {
        throw new Error(`Descriptor filename must have a non-empty name: '${parsed.base}'`);
    }
    if (format.length === 0) {
        throw new Error(`Descriptor filename must have a non-empty format: '${parsed.base}'`);
    }
    return { kind, name, format: format };
}

/**
 * Derive the schema name from a descriptor filename, e.g. `device.example.yaml`
 * -> `device`.
 * @param {string|URL} url
 * @returns {string}
 */
function schemaNameFromUrl(url) {
    return descriptorIdFromUrl(url).kind;
}

/**
 * Whether a URL points somewhere other than the local filesystem. Bytes behind
 * a remote URL live outside the author's control and version history, so they
 * are the ones a pin most usefully locks; local `file:` bytes are already
 * tracked by the repository around them.
 * @param {URL} url
 * @returns {boolean}
 */
function isRemote(url) {
    return url.protocol !== 'file:';
}

module.exports = { toUrl, descriptorIdFromUrl, schemaNameFromUrl, isRemote };
