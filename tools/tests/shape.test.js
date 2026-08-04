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

const { walkableFields, isPlainObject, escapeSegment, NESTED_FIELDS, ROOT_FIELDS } = require('../src/shape');

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
