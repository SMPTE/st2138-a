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

const { walkableFields, isPlainObject, fillGaps, shallowMerge, escapeSegment, NESTED_FIELDS, ROOT_FIELDS, toPointer, collectImports } = require('../src/shape');

describe('walkableFields', () => {
    test('descends params and commands at a device root', () => {
        expect(walkableFields('device')).toBe(ROOT_FIELDS);
        expect(ROOT_FIELDS).toEqual(['params', 'commands']);
    });

    test('descends only params for any other kind', () => {
        expect(walkableFields('param')).toBe(NESTED_FIELDS);
        expect(walkableFields('command')).toBe(NESTED_FIELDS);
        expect(NESTED_FIELDS).toEqual(['params']);
    });
});

describe('isPlainObject', () => {
    test('accepts a plain mapping', () => {
        expect(isPlainObject({})).toBe(true);
        expect(isPlainObject({ a: 1 })).toBe(true);
    });

    test('rejects null, arrays, and scalars', () => {
        expect(isPlainObject(null)).toBe(false);
        expect(isPlainObject([1, 2])).toBe(false);
        expect(isPlainObject('text')).toBe(false);
        expect(isPlainObject(undefined)).toBe(false);
    });
});

describe('fillGaps', () => {
    test('adds only the keys the target lacks and returns the target', () => {
        const target = { value: 42 };
        const result = fillGaps(target, { oid: '0x01', value: 0 });
        expect(result).toBe(target); // mutated in place, and handed back
        expect(target).toEqual({ oid: '0x01', value: 42 }); // target's own key wins
    });

    test('links filled values by reference, not by copy', () => {
        // the caller that must not alias the source clones it first; fillGaps itself
        // shares, so the resolver's one-shot trees pay no needless copy
        const source = { help: { en: 'hi' } };
        const target = fillGaps({}, source);
        expect(target.help).toBe(source.help);
    });
});

describe('shallowMerge', () => {
    test('local scalars override imported scalars', () => {
        // an import may carry a placeholder default; the local value is real
        expect(shallowMerge({ value: 0 }, { value: 42 })).toEqual({ value: 42 });
    });

    test('keys present in only one side both survive', () => {
        const base = { oid: '0x01', type: 'INT32' };
        const local = { value: 42 };
        expect(shallowMerge(base, local)).toEqual({ oid: '0x01', type: 'INT32', value: 42 });
    });

    test('a local mapping replaces an imported mapping wholesale, not key-by-key', () => {
        // overriding `name` restates it in full: a language the local omits is
        // dropped, not inherited from the base — override means override
        const base = { name: { display_strings: { en: 'Gain', fr: 'Gain' } } };
        const local = { name: { display_strings: { en: 'Level' } } };
        expect(shallowMerge(base, local)).toEqual({
            name: { display_strings: { en: 'Level' } }
        });
    });

    test('a local scalar replaces an imported mapping wholesale', () => {
        expect(shallowMerge({ a: { deep: 1 } }, { a: 5 })).toEqual({ a: 5 });
    });

    test('a local mapping replaces an imported scalar wholesale', () => {
        expect(shallowMerge({ a: 5 }, { a: { deep: 1 } })).toEqual({ a: { deep: 1 } });
    });

    test('a differently typed value replaces the base whole, not blended', () => {
        // a base INT32 specialized to INT32_ARRAY: the array value stands alone,
        // never merged with the scalar into an invalid two-branch union
        const base = { type: 'INT32', value: { int32_value: 4 } };
        const local = { type: 'INT32_ARRAY', value: { int32_array_values: { ints: [1, 2, 3] } } };
        expect(shallowMerge(base, local)).toEqual({
            type: 'INT32_ARRAY',
            value: { int32_array_values: { ints: [1, 2, 3] } }
        });
    });

    test('arrays are replaced wholesale, not merged by index', () => {
        expect(shallowMerge({ items: ['a', 'b', 'c'] }, { items: ['x'] })).toEqual({
            items: ['x']
        });
    });

    test('a non-mapping on either side yields the local value', () => {
        expect(shallowMerge(5, { a: 1 })).toEqual({ a: 1 });
        expect(shallowMerge({ a: 1 }, 5)).toBe(5);
        expect(shallowMerge({ a: 1 }, null)).toBe(null);
        expect(shallowMerge([1], { a: 1 })).toEqual({ a: 1 });
    });

    test('does not mutate either input', () => {
        const base = { help: { en: 'imported', fr: 'aide' } };
        const local = { value: 42 };
        shallowMerge(base, local);
        expect(base).toEqual({ help: { en: 'imported', fr: 'aide' } });
        expect(local).toEqual({ value: 42 });
    });
});

describe('escapeSegment', () => {
    test('escapes ~ and / per RFC 6901', () => {
        expect(escapeSegment('a~b')).toBe('a~0b');
        expect(escapeSegment('a/b')).toBe('a~1b');
        expect(escapeSegment('~/')).toBe('~0~1');
    });

    test('leaves an ordinary key untouched', () => {
        expect(escapeSegment('gain')).toBe('gain');
    });
});

describe('toPointer', () => {
    test('joins escaped segments into a JSON pointer', () => {
        expect(toPointer(['params', 'gain', 'import', 'digest'])).toBe('/params/gain/import/digest');
    });

    test('escapes segments as it joins them', () => {
        expect(toPointer(['a/b', 'c~d'])).toBe('/a~1b/c~0d');
    });

    test('returns the empty string for a root path', () => {
        expect(toPointer([])).toBe('');
    });
});

describe('collectImports', () => {
    test('collects a root-level import with an empty path', () => {
        const imports = collectImports({ import: { url: 'x.yaml' } }, 'param');
        expect(imports).toEqual([{ path: [], directive: { url: 'x.yaml' } }]);
    });

    test('collects nested param imports with their key paths', () => {
        const descriptor = {
            params: {
                gain: { import: { url: 'gain.yaml' } },
                group: { params: { level: { import: { url: 'level.yaml' } } } },
            },
        };
        expect(collectImports(descriptor, 'param')).toEqual([
            { path: ['params', 'gain'], directive: { url: 'gain.yaml' } },
            { path: ['params', 'group', 'params', 'level'], directive: { url: 'level.yaml' } },
        ]);
    });

    test('descends both params and commands for a device', () => {
        const descriptor = {
            params: { gain: { import: { url: 'gain.yaml' } } },
            commands: { reboot: { import: { url: 'reboot.yaml' } } },
        };
        expect(collectImports(descriptor, 'device')).toEqual([
            { path: ['params', 'gain'], directive: { url: 'gain.yaml' } },
            { path: ['commands', 'reboot'], directive: { url: 'reboot.yaml' } },
        ]);
    });

    test('ignores a param-bearing map that is not an object', () => {
        const descriptor = { params: 'not-a-map', import: { url: 'x.yaml' } };
        expect(collectImports(descriptor, 'param')).toEqual([
            { path: [], directive: { url: 'x.yaml' } },
        ]);
    });

    test('returns nothing for a non-object descriptor', () => {
        expect(collectImports(null, 'param')).toEqual([]);
        expect(collectImports(undefined, 'device')).toEqual([]);
        expect(collectImports('text', 'param')).toEqual([]);
    });
});
