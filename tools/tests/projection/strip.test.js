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

const { stripDefinitions } = require('../../src/projection/strip');

describe('stripDefinitions', () => {
    test('keeps the root shape when there are no params', () => {
        const root = { type: 'INT32', value: { int32_value: 0 } };
        const { data, definitions, references } = stripDefinitions(root);
        expect(data).toEqual({ type: 'INT32', value: { int32_value: 0 } });
        expect(definitions).toEqual({});
        expect(references).toEqual({});
    });

    test('lifts definition-only params out of the runtime model', () => {
        const root = {
            params: {
                lib: {
                    client_hints: { st2138_namespace: 'smpte.audio' },
                    params: { fader: { type: 'FLOAT32' } },
                },
                defonly: { type: 'INT32', client_hints: { st2138_definition_only: 'true' } },
                faders: {
                    type: 'FLOAT32_ARRAY',
                    template_oid: 'lib/fader',
                    constraint: { type: 'FLOAT_RANGE', low: 0, high: 1 },
                },
                group: {
                    type: 'STRUCT',
                    params: {
                        nested_def: { client_hints: { st2138_namespace: 'x.y' }, type: 'INT32' },
                        keep: { type: 'INT32' },
                    },
                },
            },
        };

        const libNode = root.params.lib;
        const defonlyNode = root.params.defonly;
        const nestedDefNode = root.params.group.params.nested_def;

        const { data, definitions, references } = stripDefinitions(root);

        // Runtime model: definition-only params gone, template_oid stripped.
        expect(Object.keys(data.params)).toEqual(['faders', 'group']);
        expect(data.params.faders).toEqual({
            type: 'FLOAT32_ARRAY',
            constraint: { type: 'FLOAT_RANGE', low: 0, high: 1 },
        });
        expect(data.params.faders.template_oid).toBeUndefined();
        expect(Object.keys(data.params.group.params)).toEqual(['keep']);

        // Definitions: keyed by FQOID, tagged with their namespace when declared.
        expect(definitions).toEqual({
            lib: { namespace: 'smpte.audio', node: libNode },
            defonly: { namespace: undefined, node: defonlyNode },
            'group/nested_def': { namespace: 'x.y', node: nestedDefNode },
        });

        // References: the runtime param's provenance survives the stripped template_oid.
        expect(references).toEqual({ faders: 'lib/fader' });
    });

    test('mutates the input tree in place, returning it as the runtime data', () => {
        const root = {
            params: {
                faders: { type: 'FLOAT32_ARRAY', template_oid: 'lib/fader' },
            },
        };
        const { data } = stripDefinitions(root);
        expect(data).toBe(root);
        expect(root.params.faders.template_oid).toBeUndefined();
    });

    test('passes a non-mapping param value through untouched', () => {
        const root = { params: { scalar: 5 } };
        const { data, definitions, references } = stripDefinitions(root);
        expect(data.params).toEqual({ scalar: 5 });
        expect(definitions).toEqual({});
        expect(references).toEqual({});
    });
});
