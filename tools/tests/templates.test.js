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

const { expandTemplates, resolveFqoid } = require('../src/templates');

describe('resolveFqoid', () => {
    const root = {
        params: {
            lib: { params: { fader: { type: 'FLOAT32' } }, },
            leaf: { type: 'INT32' },
            scalar: 5,
        },
    };

    test('walks params segment by segment to the target', () => {
        expect(resolveFqoid(root, 'lib/fader')).toBe(root.params.lib.params.fader);
    });

    test('returns undefined when a segment is missing', () => {
        expect(resolveFqoid(root, 'lib/missing')).toBeUndefined();
    });

    test('returns undefined when an intermediate node has no params', () => {
        expect(resolveFqoid(root, 'leaf/deeper')).toBeUndefined();
    });

    test('returns undefined when the target is not a mapping', () => {
        expect(resolveFqoid(root, 'scalar')).toBeUndefined();
    });
});

describe('expandTemplates', () => {
    test('passes a non-object model through', () => {
        const result = expandTemplates(null);
        expect(result.data).toBeNull();
        expect(result.diagnostics).toEqual([]);
        expect(result.valid).toBe(true);
    });

    test('passes a descriptor with no params through by reference', () => {
        const model = { type: 'FLOAT_RANGE', low: 0, high: 1 };
        const result = expandTemplates(model);
        expect(result.data).toBe(model);
        expect(result.diagnostics).toEqual([]);
    });

    test('returns the same tree by reference when there is nothing to expand', () => {
        const model = {
            params: {
                gain: { type: 'INT32', value: { int32_value: 0 } },
                nested: { type: 'STRUCT', params: { inner: { type: 'INT32' } } },
            },
        };
        const result = expandTemplates(model);
        expect(result.data).toBe(model);
        expect(result.diagnostics).toEqual([]);
    });

    test('leaves a root template_oid as authored', () => {
        // A root template_oid names a source in the device the param will be
        // embedded in; standalone expansion neither resolves nor removes it.
        const model = { type: 'INT32', template_oid: 'lib/base' };
        const result = expandTemplates(model);
        expect(result.data).toBe(model);
        expect(result.data.template_oid).toBe('lib/base');
        expect(result.diagnostics).toEqual([]);
    });

    test('fills a consumer from its template while retaining source and template_oid', () => {
        const model = {
            params: {
                lib: {
                    client_hints: { st2138_namespace: 'smpte.audio' },
                    params: {
                        fader: {
                            type: 'FLOAT32',
                            constraint: { type: 'FLOAT_RANGE', low: 0, high: 1 },
                            client_hints: { st2138_namespace: 'smpte.audio', widget: 'slider' },
                        },
                        eq: {
                            type: 'STRUCT',
                            client_hints: { st2138_definition_only: 'true' },
                            params: { freq: { type: 'FLOAT32' } },
                        },
                    },
                },
                faders: { type: 'FLOAT32_ARRAY', template_oid: 'lib/fader' },
                single_eq: { type: 'STRUCT', template_oid: 'lib/eq' },
            },
        };

        const result = expandTemplates(model);
        expect(result.diagnostics).toEqual([]);
        expect(result.valid).toBe(true);
        expect(result.data).not.toBe(model); // a tree with templates is cloned

        // The source and every consumer's template_oid stay in the tree.
        expect(Object.keys(result.data.params)).toEqual(['lib', 'faders', 'single_eq']);
        expect(result.data.params.faders.template_oid).toBe('lib/fader');

        // The consumer keeps its own type and gains the template's constraint.
        expect(result.data.params.faders.type).toBe('FLOAT32_ARRAY');
        expect(result.data.params.faders.constraint).toEqual({ type: 'FLOAT_RANGE', low: 0, high: 1 });
        // A reserved (lexical) hint is not inherited; a free-form one is.
        expect(result.data.params.faders.client_hints).toEqual({ widget: 'slider' });
        // The inherited constraint is a copy, not an alias of the source's.
        expect(result.data.params.faders.constraint).not.toBe(result.data.params.lib.params.fader.constraint);

        // A template whose only hint is reserved contributes no client_hints.
        expect(result.data.params.single_eq.params).toEqual({ freq: { type: 'FLOAT32' } });
        expect(result.data.params.single_eq.client_hints).toBeUndefined();

        // The input is untouched.
        expect(model.params.faders.constraint).toBeUndefined();
    });

    test('expands a chain, filling through each link', () => {
        const model = {
            params: {
                lib: {
                    params: {
                        base: { type: 'FLOAT32', constraint: { type: 'FLOAT_RANGE', low: -1, high: 1 } },
                        fader: { type: 'FLOAT32', template_oid: 'lib/base' },
                    },
                },
                faders: { type: 'FLOAT32_ARRAY', template_oid: 'lib/fader' },
            },
        };

        const result = expandTemplates(model);
        expect(result.diagnostics).toEqual([]);
        // The chain resolved fully: faders picked up base's constraint through fader.
        expect(result.data.params.faders.constraint).toEqual({ type: 'FLOAT_RANGE', low: -1, high: 1 });
        // fader's own template_oid is not copied into faders; faders keeps its own.
        expect(result.data.params.faders.template_oid).toBe('lib/fader');
    });

    test('reports a template_oid that does not resolve', () => {
        const model = { params: { x: { type: 'INT32', template_oid: 'nope/gone' } } };
        const result = expandTemplates(model);
        expect(result.diagnostics).toEqual([
            {
                level: 'error',
                message: "template_oid 'nope/gone' does not resolve to a parameter",
                instancePath: '/params/x/template_oid',
                lines: null,
            },
        ]);
        expect(result.valid).toBe(false);
    });

    test('reports a mutual cycle', () => {
        const model = {
            params: {
                a: { type: 'INT32', template_oid: 'b' },
                b: { type: 'INT32', template_oid: 'a' },
            },
        };
        const result = expandTemplates(model);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].message).toMatch(/forms a cycle/);
    });

    test('reports a self-reference as a cycle', () => {
        const model = { params: { s: { type: 'INT32', template_oid: 's' } } };
        const result = expandTemplates(model);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].message).toBe("template_oid 's' forms a cycle");
    });

    test('skips a non-mapping param value alongside a template', () => {
        const model = {
            params: {
                scalar: 5,
                x: { type: 'INT32', template_oid: 'y' },
                y: { type: 'INT32', constraint: { type: 'INT_RANGE', low: 0, high: 10 } },
            },
        };
        const result = expandTemplates(model);
        expect(result.diagnostics).toEqual([]);
        expect(result.data.params.scalar).toBe(5);
        expect(result.data.params.x.constraint).toEqual({ type: 'INT_RANGE', low: 0, high: 10 });
    });

    test('omits client_hints entirely when the source offers a non-mapping', () => {
        const model = {
            params: {
                lib: { params: { src: { type: 'INT32', client_hints: 'oops' } } },
                consumer: { type: 'INT32', template_oid: 'lib/src' },
            },
        };
        const result = expandTemplates(model);
        expect(result.diagnostics).toEqual([]);
        expect(result.data.params.consumer.client_hints).toBeUndefined();
    });

    test('inherits every non-reserved client_hint, dropping only the reserved ones', () => {
        const model = {
            params: {
                lib: {
                    params: {
                        src: {
                            type: 'INT32',
                            client_hints: {
                                st2138_namespace: 'smpte.audio',
                                st2138_definition_only: 'true',
                                widget: 'slider',
                            },
                        },
                    },
                },
                consumer: { type: 'INT32', template_oid: 'lib/src' },
            },
        };
        const result = expandTemplates(model);
        expect(result.diagnostics).toEqual([]);
        expect(result.data.params.consumer.client_hints).toEqual({ widget: 'slider' });
    });
});
