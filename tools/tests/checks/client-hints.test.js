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

const { createClientHintsVisitor } = require('../../src/checks/client-hints');
const { walkDesc } = require('../../src/checks/walker');

// drive the client-hints visitor through the walker the same way runChecks does
function validateClientHints(data, opts) {
    const visitor = createClientHintsVisitor(data, opts);
    if (!visitor) return [];
    const warnings = [];
    walkDesc(data, [visitor], warnings, opts.schemaName);
    return warnings;
}

describe('validateClientHints', () => {
    test('accepts a param with no client hints', () => {
        const data = { type: 'INT32', value: { int32_value: 0 } };
        expect(validateClientHints(data, { schemaName: 'param' })).toEqual([]);
    });

    test('accepts free-form (non-reserved) client hints', () => {
        const data = { client_hints: { widget: 'slider', color: 'blue' } };
        expect(validateClientHints(data, { schemaName: 'param' })).toEqual([]);
    });

    test('accepts a well-formed dotted namespace', () => {
        const data = { client_hints: { st2138_namespace: 'org.smpte.st2138.audio' } };
        expect(validateClientHints(data, { schemaName: 'param' })).toEqual([]);
    });

    test('accepts an explicit definition-only marker of exactly "true"', () => {
        const data = { client_hints: { st2138_definition_only: 'true' } };
        expect(validateClientHints(data, { schemaName: 'param' })).toEqual([]);
    });

    test('R1: rejects an unrecognized reserved (st2138_) hint', () => {
        const data = { client_hints: { st2138_flavor: 'grape' } };
        expect(validateClientHints(data, { schemaName: 'param' })).toEqual([
            {
                message: "Unrecognized reserved client hint 'st2138_flavor'; 'st2138_' hints must be one of: st2138_namespace, st2138_definition_only",
                instancePath: '/client_hints/st2138_flavor',
                type: 'error',
            },
        ]);
    });

    test('R2: rejects a definition-only marker that is not exactly "true"', () => {
        const data = { client_hints: { st2138_definition_only: 'false' } };
        expect(validateClientHints(data, { schemaName: 'param' })).toEqual([
            {
                message: 'Client hint \'st2138_definition_only\' must be the exact string "true"',
                instancePath: '/client_hints/st2138_definition_only',
                type: 'error',
            },
        ]);
    });

    test('R3: rejects a namespace that is not dot-separated segments', () => {
        const data = { client_hints: { st2138_namespace: 'org::smpte::audio' } };
        expect(validateClientHints(data, { schemaName: 'param' })).toEqual([
            {
                message: "Client hint 'st2138_namespace' value 'org::smpte::audio' is not a valid namespace; use dot-separated segments (e.g. 'org.smpte.st2138.audio')",
                instancePath: '/client_hints/st2138_namespace',
                type: 'error',
            },
        ]);
    });

    test('R3: rejects a namespace with a trailing dot', () => {
        const data = { client_hints: { st2138_namespace: 'org.smpte.' } };
        const errors = validateClientHints(data, { schemaName: 'param' });
        expect(errors).toHaveLength(1);
        expect(errors[0].instancePath).toBe('/client_hints/st2138_namespace');
    });

    test('checks reserved hints on a device\'s params and commands', () => {
        const data = {
            params: { gain: { client_hints: { st2138_flavor: 'x' } } },
            commands: { reboot: { client_hints: { st2138_definition_only: 'yes' } } },
        };
        const errors = validateClientHints(data, { schemaName: 'device' });
        expect(errors.map((e) => e.instancePath)).toEqual([
            '/params/gain/client_hints/st2138_flavor',
            '/commands/reboot/client_hints/st2138_definition_only',
        ]);
    });

    test('descends into a command\'s nested arguments', () => {
        const data = {
            commands: {
                reboot: {
                    params: { mode: { client_hints: { st2138_flavor: 'x' } } },
                },
            },
        };
        const errors = validateClientHints(data, { schemaName: 'device' });
        expect(errors).toHaveLength(1);
        expect(errors[0].instancePath).toBe('/commands/reboot/params/mode/client_hints/st2138_flavor');
    });

    test('descends into nested params', () => {
        const data = {
            params: {
                outer: {
                    params: { inner: { client_hints: { st2138_namespace: 'bad::ns' } } },
                },
            },
        };
        const errors = validateClientHints(data, { schemaName: 'device' });
        expect(errors).toHaveLength(1);
        expect(errors[0].instancePath).toBe('/params/outer/params/inner/client_hints/st2138_namespace');
    });

    test('escapes special characters in a param key pointer', () => {
        const data = { params: { 'a/b': { client_hints: { st2138_flavor: 'x' } } } };
        const errors = validateClientHints(data, { schemaName: 'device' });
        expect(errors[0].instancePath).toBe('/params/a~1b/client_hints/st2138_flavor');
    });

    test('ignores a client_hints that is not a mapping (left to the schema)', () => {
        const data = { client_hints: 'nope' };
        expect(validateClientHints(data, { schemaName: 'param' })).toEqual([]);
    });

    test('ignores a params entry that is not a mapping', () => {
        const data = { params: { gain: 42 } };
        expect(validateClientHints(data, { schemaName: 'device' })).toEqual([]);
    });

    test('ignores non-object data', () => {
        expect(validateClientHints(null, { schemaName: 'param' })).toEqual([]);
    });

    test('returns nothing when the check is disabled', () => {
        const data = { client_hints: { st2138_flavor: 'x' } };
        expect(validateClientHints(data, { schemaName: 'param', disableClientHintChecks: true })).toEqual([]);
    });
});
