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

const { validateImportDigests } = require('../../src/checks/digest');

/** A well-formed base64-encoded sha256 (32 zero bytes). */
const VALID_DIGEST = Buffer.alloc(32).toString('base64');
/** Base64 that decodes to fewer than 32 bytes. */
const SHORT_DIGEST = Buffer.alloc(2).toString('base64');

describe('validateImportDigests', () => {
    test('accepts an import whose digest decodes to 32 bytes', () => {
        const data = { params: { gain: { import: { url: 'gain.yaml', digest: VALID_DIGEST } } } };
        expect(validateImportDigests(data, { schemaName: 'param' })).toEqual([]);
    });

    test('rejects an import whose digest is not a 32-byte sha256', () => {
        const data = { params: { gain: { import: { url: 'gain.yaml', digest: SHORT_DIGEST } } } };
        expect(validateImportDigests(data, { schemaName: 'param' })).toEqual([
            {
                message: 'Import digest must be a base64-encoded sha256 (32 bytes)',
                instancePath: '/params/gain/import/digest',
                type: 'error',
            },
        ]);
    });

    test('locates an undecodable digest on a root-level import', () => {
        const data = { import: { url: 'root.yaml', digest: SHORT_DIGEST } };
        const errors = validateImportDigests(data, { schemaName: 'param' });
        expect(errors).toHaveLength(1);
        expect(errors[0].instancePath).toBe('/import/digest');
    });

    test('checks command imports on a device', () => {
        const data = { commands: { reboot: { import: { url: 'reboot.yaml', digest: SHORT_DIGEST } } } };
        const errors = validateImportDigests(data, { schemaName: 'device' });
        expect(errors).toHaveLength(1);
        expect(errors[0].instancePath).toBe('/commands/reboot/import/digest');
    });

    test('ignores an import that declares no digest', () => {
        const data = { params: { gain: { import: { url: 'gain.yaml' } } } };
        expect(validateImportDigests(data, { schemaName: 'param' })).toEqual([]);
    });

    test('leaves a non-string digest to the schema', () => {
        const data = { params: { gain: { import: { url: 'gain.yaml', digest: 42 } } } };
        expect(validateImportDigests(data, { schemaName: 'param' })).toEqual([]);
    });

    test('returns nothing when the check is disabled', () => {
        const data = { import: { url: 'root.yaml', digest: SHORT_DIGEST } };
        expect(validateImportDigests(data, { schemaName: 'param', disableDigestChecks: true })).toEqual([]);
    });
});
