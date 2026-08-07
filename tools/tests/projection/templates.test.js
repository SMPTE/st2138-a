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

const { expandTemplates, resolveFqoid } = require('../../src/projection/templates');

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
    test('does nothing when the root has no params', () => {
        const root = { type: 'INT32' };
        expect(expandTemplates(root)).toEqual([]);
        expect(root).toEqual({ type: 'INT32' });
    });

    test('fills a consumer with the fields it lacks from its template', () => {
        const root = {
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

        const diagnostics = expandTemplates(root);
        expect(diagnostics).toEqual([]);

        // The consumer keeps its own type and gains the template's constraint.
        expect(root.params.faders.type).toBe('FLOAT32_ARRAY');
        expect(root.params.faders.constraint).toEqual({ type: 'FLOAT_RANGE', low: 0, high: 1 });
        // A reserved (lexical) hint is not inherited; a free-form one is.
        expect(root.params.faders.client_hints).toEqual({ widget: 'slider' });
        // The inherited constraint is a copy, not an alias of the source's.
        expect(root.params.faders.constraint).not.toBe(root.params.lib.params.fader.constraint);

        // A template whose only hint is reserved contributes no client_hints.
        expect(root.params.single_eq.params).toEqual({ freq: { type: 'FLOAT32' } });
        expect(root.params.single_eq.client_hints).toBeUndefined();
    });

    test('expands a chain, dropping neither the consumer fields nor the source template_oid', () => {
        const root = {
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

        expect(expandTemplates(root)).toEqual([]);
        // The chain resolved fully: faders picked up base's constraint through fader.
        expect(root.params.faders.constraint).toEqual({ type: 'FLOAT_RANGE', low: -1, high: 1 });
        // fader's own template_oid is not copied into faders; the strip pass removes it.
        expect(root.params.faders.template_oid).toBe('lib/fader');
    });

    test('reports a template_oid that does not resolve', () => {
        const root = { params: { x: { type: 'INT32', template_oid: 'nope/gone' } } };
        const diagnostics = expandTemplates(root);
        expect(diagnostics).toEqual([
            {
                level: 'error',
                message: "template_oid 'nope/gone' does not resolve to a parameter",
                instancePath: '/params/x/template_oid',
                lines: null,
            },
        ]);
    });

    test('reports a mutual cycle', () => {
        const root = {
            params: {
                a: { type: 'INT32', template_oid: 'b' },
                b: { type: 'INT32', template_oid: 'a' },
            },
        };
        const diagnostics = expandTemplates(root);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].message).toMatch(/forms a cycle/);
    });

    test('reports a self-reference as a cycle', () => {
        const root = { params: { s: { type: 'INT32', template_oid: 's' } } };
        const diagnostics = expandTemplates(root);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].message).toBe("template_oid 's' forms a cycle");
    });

    test('ignores a non-mapping param value', () => {
        const root = { params: { scalar: 5 } };
        expect(expandTemplates(root)).toEqual([]);
        expect(root.params.scalar).toBe(5);
    });

    test('omits client_hints entirely when a non-mapping is offered by the source', () => {
        // A template source whose client_hints is not a map contributes none.
        const root = {
            params: {
                lib: { params: { src: { type: 'INT32', client_hints: 'oops' } } },
                consumer: { type: 'INT32', template_oid: 'lib/src' },
            },
        };
        expect(expandTemplates(root)).toEqual([]);
        expect(root.params.consumer.client_hints).toBeUndefined();
    });

    test('inherits every non-reserved client_hint untouched, dropping only the reserved ones', () => {
        // The source mixes reserved lexical hints with free-form ones of varied
        // shapes; only the reserved keys are stripped, the rest pass through as-is.
        const root = {
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
        expect(expandTemplates(root)).toEqual([]);
        expect(root.params.consumer.client_hints).toEqual({
            widget: 'slider',
        });
        // Nested values are copied, not aliased back to the source.
        expect(root.params.consumer.client_hints.widget).toBe('slider');
    });
});
