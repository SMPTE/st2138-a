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

'use strict';

const { collectImports, toPointer } = require('../shape');
const { decodeDigest } = require('../digest');
const { ERROR } = require('./constants');

/**
 * Validate that every declared `import.digest` is a well-formed base64 sha256.
 *
 * This is a static, content-only property of the file — knowable from its own
 * text, no I/O — so it lives in the before-validate gate alongside the schema.
 * Whether the *fetched* bytes actually match a digest is a separate, load-time
 * concern the loader reports at resolution; here we only reject a digest that
 * could never match anything because it does not decode to a sha256's 32 bytes
 * (the schema enforces base64 encoding, but not the length). Because imports
 * appear in param and device descriptors alike, this check applies to every
 * schema kind rather than gating on `schemaName`.
 *
 * @param {object} data the parsed descriptor to check
 * @param {object} opts
 * @param {string} opts.schemaName the descriptor's schema kind
 * @param {boolean} [opts.disableDigestChecks] if true, skip this check
 * @returns {Array<{message: string, instancePath: string, type: string}>} errors,
 *   empty when every digest decodes (or none is declared)
 */
function validateImportDigests(data, opts) {
    if (opts.disableDigestChecks) return [];

    const errors = [];
    for (const { path, directive } of collectImports(data, opts.schemaName)) {
        // A missing or non-string digest is not this check's concern: an absent
        // digest simply means "unpinned", and the schema owns the type.
        if (typeof directive.digest !== 'string') continue;

        try {
            decodeDigest(directive.digest);
        } catch {
            errors.push({
                message: 'Import digest must be a base64-encoded sha256 (32 bytes)',
                instancePath: toPointer([...path, 'import', 'digest']),
                type: ERROR,
            });
        }
    }
    return errors;
}

module.exports = { validateImportDigests };
