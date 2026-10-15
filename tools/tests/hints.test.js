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

const hints = require('../src/hints');

describe('reserved vocabulary', () => {
    test('recognizes exactly the namespace and definition-only keys', () => {
        expect([...hints.RECOGNIZED_HINTS]).toEqual([hints.NAMESPACE_KEY, hints.DEFINITION_ONLY_KEY]);
        expect(hints.NAMESPACE_KEY.startsWith(hints.RESERVED_PREFIX)).toBe(true);
        expect(hints.DEFINITION_ONLY_KEY.startsWith(hints.RESERVED_PREFIX)).toBe(true);
    });
});

describe('namespaceOf', () => {
    test('returns the declared namespace', () => {
        const node = { client_hints: { st2138_namespace: 'a.b.c' } };
        expect(hints.namespaceOf(node)).toBe('a.b.c');
    });

    test('treats an empty-string namespace as none', () => {
        const node = { client_hints: { st2138_namespace: '' } };
        expect(hints.namespaceOf(node)).toBeNull();
    });

    test('returns null when the namespace is not a string', () => {
        const node = { client_hints: { st2138_namespace: 42 } };
        expect(hints.namespaceOf(node)).toBeNull();
    });

    test('returns null when there are no client hints', () => {
        expect(hints.namespaceOf({})).toBeNull();
    });

    test('returns null for a non-mapping node', () => {
        expect(hints.namespaceOf(null)).toBeNull();
        expect(hints.namespaceOf([1, 2])).toBeNull();
        expect(hints.namespaceOf('x')).toBeNull();
    });
});

describe('isDefinitionOnly', () => {
    test('a namespace root is definition-only', () => {
        expect(hints.isDefinitionOnly({ client_hints: { st2138_namespace: 'a.b' } })).toBe(true);
    });

    test('an explicit definition-only marker of "true" is definition-only', () => {
        expect(hints.isDefinitionOnly({ client_hints: { st2138_definition_only: 'true' } })).toBe(true);
    });

    test('a marker other than "true" is not definition-only', () => {
        expect(hints.isDefinitionOnly({ client_hints: { st2138_definition_only: 'false' } })).toBe(false);
    });

    test('a plain runtime param is not definition-only', () => {
        expect(hints.isDefinitionOnly({ type: 'INT32' })).toBe(false);
    });
});
