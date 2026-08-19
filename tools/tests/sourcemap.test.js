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

const { parse } = require('../src/sourcemap');

describe('sourcemap.parse', () => {
    test('maps YAML nodes to their original 1-based line numbers', () => {
        // line: 1        2         3        4          5              6
        const raw = [
            'name: widget',      // 1
            'type: INT32',       // 2
            'value:',            // 3
            '  int32_value: 7',  // 4
            'nested:',           // 5
            '  items:',          // 6
            '    - a',           // 7
            '    - b',           // 8
        ].join('\n');

        const { data, sourceMap } = parse(raw);

        expect(data).toEqual({
            name: 'widget',
            type: 'INT32',
            value: { int32_value: 7 },
            nested: { items: ['a', 'b'] },
        });

        // scalar leaves resolve to their own line
        expect(sourceMap.linesFor('/type').start).toBe(2);
        expect(sourceMap.linesFor('/value/int32_value').start).toBe(4);
        // sequence items are addressed by index
        expect(sourceMap.linesFor('/nested/items/0').start).toBe(7);
        expect(sourceMap.linesFor('/nested/items/1').start).toBe(8);
        // a container spans from its first to its last line
        expect(sourceMap.linesFor('/nested').start).toBe(6);
        expect(sourceMap.linesFor('/nested/items').end).toBeGreaterThanOrEqual(8);
    });

    test('reports lines against the original text, not a re-serialization', () => {
        // blank lines and comments shift real line numbers; a canonical
        // re-serialization would collapse them and report the wrong lines.
        const raw = [
            '# a leading comment',   // 1
            '',                      // 2
            '',                      // 3
            'type: INT32',           // 4
        ].join('\n');

        const { sourceMap } = parse(raw);
        expect(sourceMap.linesFor('/type').start).toBe(4);
    });

    test('parses JSON (a subset of YAML) via the same path', () => {
        const raw = JSON.stringify({ a: 1, b: { c: 2 } }, null, 2);
        const { data, sourceMap } = parse(raw);

        expect(data).toEqual({ a: 1, b: { c: 2 } });
        expect(sourceMap.linesFor('/b/c').start).toBe(4);
    });

    test('unescapes ~ and / in pointer segments per RFC 6901', () => {
        const raw = ['"a/b": 1', '"c~d": 2'].join('\n');
        const { sourceMap } = parse(raw);

        expect(sourceMap.linesFor('/a~1b').start).toBe(1);
        expect(sourceMap.linesFor('/c~0d').start).toBe(2);
    });

    test('resolves an empty mapping value and returns null for absent paths', () => {
        const raw = ['a:', 'b: 2'].join('\n');
        const { data, sourceMap } = parse(raw);

        expect(data).toEqual({ a: null, b: 2 });
        // an empty value still parses to a ranged null node on its own line
        expect(sourceMap.linesFor('/a').start).toBe(1);
        expect(sourceMap.linesFor('/b').start).toBe(2);
        // a pointer that addresses nothing resolves to null
        expect(sourceMap.linesFor('/missing')).toBeNull();
    });

    test('returns null for every pointer in a document with no content', () => {
        const { data, sourceMap } = parse('# just a comment\n');

        // contents parse to null; the root and any path resolve to null
        expect(data).toBeNull();
        expect(sourceMap.linesFor('')).toBeNull();
        expect(sourceMap.linesFor('/anything')).toBeNull();
    });

    test('throws on malformed input', () => {
        // an unclosed flow mapping is a hard parse error
        expect(() => parse('{ a: 1')).toThrow();
    });
});
