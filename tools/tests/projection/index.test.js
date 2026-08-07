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

const { project } = require('../../src/projection');

describe('project', () => {
    test('passes a non-device descriptor through by reference', () => {
        const model = { type: 'INT32', template_oid: 'lib/x' };
        const result = project(model, 'param');
        expect(result.data).toBe(model);
        expect(result.definitions).toEqual({});
        expect(result.references).toEqual({});
        expect(result.diagnostics).toEqual([]);
    });

    test('passes a non-object model through', () => {
        const result = project(null, 'device');
        expect(result.data).toBeNull();
        expect(result.definitions).toEqual({});
        expect(result.references).toEqual({});
    });

    test('returns the same tree by reference when there is nothing to project', () => {
        const model = {
            params: {
                gain: { type: 'INT32', value: { int32_value: 0 } },
                nested: { type: 'STRUCT', params: { inner: { type: 'INT32' } } },
            },
        };
        const result = project(model, 'device');
        expect(result.data).toBe(model);
        expect(result.definitions).toEqual({});
        expect(result.references).toEqual({});
        expect(result.diagnostics).toEqual([]);
    });

    test('expands templates and strips definitions for a device', () => {
        const model = {
            params: {
                lib: {
                    client_hints: { st2138_namespace: 'smpte.audio' },
                    params: {
                        fader: { type: 'FLOAT32', constraint: { type: 'FLOAT_RANGE', low: 0, high: 1 } },
                    },
                },
                faders: { type: 'FLOAT32_ARRAY', template_oid: 'lib/fader' },
            },
        };
        const result = project(model, 'device');

        expect(result.data).not.toBe(model); // a projected tree is a fresh copy
        expect(Object.keys(result.data.params)).toEqual(['faders']);
        expect(result.data.params.faders).toEqual({
            type: 'FLOAT32_ARRAY',
            constraint: { type: 'FLOAT_RANGE', low: 0, high: 1 },
        });
        expect(result.definitions).toEqual({
            lib: { namespace: 'smpte.audio', node: expect.any(Object) },
        });
        expect(result.references).toEqual({ faders: 'lib/fader' });
        expect(result.diagnostics).toEqual([]);
        // The input is untouched.
        expect(model.params.faders.template_oid).toBe('lib/fader');
    });

    test('detects a definition-only param nested under a runtime param', () => {
        const model = {
            params: {
                group: {
                    type: 'STRUCT',
                    params: { 
                        def: { client_hints: { st2138_definition_only: 'true' }, type: 'INT32' },
                        stay: { type: 'INT32' },
                    },
                },
            },
        };
        const result = project(model, 'device');
        expect(result.data).not.toBe(model);
        expect(Object.keys(result.data.params.group.params)).toEqual(['stay']);
        expect(result.definitions).toEqual({
            'group/def': { node: expect.any(Object) },
        });
        expect(result.references).toEqual({});
        expect(result.diagnostics).toEqual([]);
        // The input is untouched.
        expect(model.params.group.params.def.client_hints.st2138_definition_only).toBe('true');
    });

    test('surfaces an unresolved template as a diagnostic', () => {
        const model = { params: { x: { type: 'INT32', template_oid: 'gone' } } };
        const result = project(model, 'device');
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].level).toBe('error');
    });

    test('treats a device without params as nothing to project', () => {
        const model = { connection: {} };
        const result = project(model, 'device');
        expect(result.data).toBe(model);
    });

    test('skips a non-mapping param value while scanning for work', () => {
        const model = { params: { scalar: 5, gain: { type: 'INT32' } } };
        const result = project(model, 'device');
        expect(result.data).toBe(model); // nothing projectable, passed through
    });
});
