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

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { toUrl, schemaNameFromUrl, isRemote } = require('../src/urls');

describe('toUrl', () => {
    test('returns a URL instance unchanged', () => {
        const url = new URL('file:///tmp/device.example.yaml');
        expect(toUrl(url)).toBe(url);
    });

    test('resolves a relative path string to an absolute file URL', () => {
        const url = toUrl('examples/device.example.yaml');
        expect(url).toBeInstanceOf(URL);
        expect(url.protocol).toBe('file:');
        expect(url.href).toBe(pathToFileURL(path.resolve('examples/device.example.yaml')).href);
    });

    test('resolves an already-absolute path string to a file URL', () => {
        const abs = path.resolve('/tmp/some/device.example.yaml');
        const url = toUrl(abs);
        expect(url.protocol).toBe('file:');
        expect(url.href).toBe(pathToFileURL(abs).href);
    });

    test('percent-encodes spaces and reserved characters instead of truncating', () => {
        const input = 'examples/my dir/dev#1?draft.yaml';
        const url = toUrl(input);
        // string concatenation would have dropped everything from '#'/'?' onward
        expect(url.pathname).toContain('%20');
        expect(url.pathname).toContain('%23');
        expect(url.pathname).toContain('%3F');
        expect(decodeURIComponent(url.pathname).endsWith('my dir/dev#1?draft.yaml')).toBe(true);
        expect(url.href).toBe(pathToFileURL(path.resolve(input)).href);
    });

    test('passes through a string that already carries a scheme', () => {
        const url = toUrl('https://example.com/device.json');
        expect(url).toBeInstanceOf(URL);
        expect(url.protocol).toBe('https:');
        expect(url.href).toBe('https://example.com/device.json');
    });
});

describe('schemaNameFromUrl', () => {
    test('derives the schema name from a multi-part filename', () => {
        expect(schemaNameFromUrl(new URL('file:///a/b/device.example.yaml'))).toBe('device');
    });

    test('derives the schema name from a param descriptor filename', () => {
        expect(schemaNameFromUrl(new URL('file:///a/b/param.on_off.yaml'))).toBe('param');
    });
});

describe('isRemote', () => {
    test('treats a file URL as local', () => {
        expect(isRemote(new URL('file:///models/param.on_off.yaml'))).toBe(false);
    });

    test('treats an http(s) URL as remote', () => {
        expect(isRemote(new URL('https://cdn.example.com/param.on_off.yaml'))).toBe(true);
    });
});
