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

const crypto = require('node:crypto');
const { decodeDigest, computeDigest, digestsMatch } = require('../src/digest');

describe('decodeDigest', () => {
    test('decodes a base64 sha256 digest into its 32 raw bytes', () => {
        const bytes = crypto.createHash('sha256').update('payload').digest();
        expect(decodeDigest(bytes.toString('base64'))).toEqual(bytes);
    });

    test('throws when the value does not decode to a sha256 (32 bytes)', () => {
        // base64 decoding is lenient: 'invalid_base64' yields 10 bytes, not 32
        expect(() => decodeDigest('invalid_base64')).toThrow(/sha256/i);
    });

    test('rejects a valid digest with an appended out-of-alphabet character', () => {
        // the extra '!' makes the input too long, before any decoding happens
        const digest = computeDigest('payload');
        expect(() => decodeDigest(`${digest}!`)).toThrow(/sha256/i);
    });

    test('rejects an out-of-alphabet character that keeps the input length', () => {
        // Buffer.from silently drops the '!', so the decode falls short of 32 bytes
        const digest = computeDigest('payload');
        expect(() => decodeDigest(`!${digest.slice(1)}`)).toThrow(/sha256/i);
    });

    test('returns null when the digest is absent', () => {
        expect(decodeDigest(null)).toBeNull();
        expect(decodeDigest(undefined)).toBeNull();
        expect(decodeDigest('')).toBeNull();
    });
});

describe('computeDigest', () => {
    test('returns the base64 sha256 of the given bytes', () => {
        const expected = crypto.createHash('sha256').update('payload').digest('base64');
        expect(computeDigest('payload')).toBe(expected);
    });

    test('produces a digest that decodes back to 32 bytes', () => {
        expect(decodeDigest(computeDigest('payload'))).toHaveLength(32);
    });
});

describe('digestsMatch', () => {
    test('true when two digests denote the same bytes', () => {
        const digest = computeDigest('payload');
        expect(digestsMatch(digest, digest)).toBe(true);
    });

    test('false when the digests denote different bytes', () => {
        expect(digestsMatch(computeDigest('a'), computeDigest('b'))).toBe(false);
    });

    test('is blind to base64 padding: the same bytes match either way', () => {
        const canonical = computeDigest('payload');
        const unpadded = canonical.replace(/=+$/, '');
        expect(digestsMatch(canonical, unpadded)).toBe(true);
    });

    test('throws when either digest is malformed (does not decode to 32 bytes)', () => {
        const digest = computeDigest('payload');
        expect(() => digestsMatch(digest, 'invalid_base64')).toThrow(/sha256/i);
        expect(() => digestsMatch('invalid_base64', digest)).toThrow(/sha256/i);
    });
});