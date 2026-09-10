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

const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { pin, assertWritable } = require('../src/pin');
const loader = require('../src/loader');

const b64 = (text) => crypto.createHash('sha256').update(text).digest('base64');

const GAIN = 'name:\n  display_strings:\n    en: Gain\ntype: INT32\n';
const GAIN_DIGEST = b64(GAIN);
const REBOOT = 'name:\n  display_strings:\n    en: Reboot\nresponse: true\n';
const REBOOT_DIGEST = b64(REBOOT);

/** A transport backed by an in-memory map of URL href -> text. */
function mapLoad(entries) {
    const files = new Map(Object.entries(entries).map(([href, text]) => [new URL(href).href, text]));
    return async (url) => {
        if (!files.has(url.href)) {
            throw new Error(`Cannot open ${url.href}`);
        }
        return Buffer.from(files.get(url.href));
    };
}

// Remote descriptors and imports: the default pin scope.
const BASE = 'https://models.example.com/';
const ROOT = `${BASE}param.root.yaml`;
const GAIN_URL = `${BASE}param.gain.yaml`;
const REBOOT_URL = `${BASE}command.reboot.yaml`;
const DEVICE_URL = `${BASE}device.example.yaml`;

// A local descriptor whose relative imports resolve to file: URLs.
const LOCAL_ROOT = 'file:///models/param.root.yaml';
const LOCAL_GAIN_URL = 'file:///models/param.gain.yaml';

describe('pin', () => {
    test('adds a digest to an import that has none and preserves comments', async () => {
        const parent = [
            '# top level comment',
            'params:',
            '  s: hello',
            '  a:',
            '    - 1',
            '    - 2',
            '  gain:',
            '    import:',
            '      url: ./param.gain.yaml',
            '',
        ].join('\n');
        const load = mapLoad({ [ROOT]: parent, [GAIN_URL]: GAIN });

        const result = await pin(new URL(ROOT), { load });

        expect(result.ok).toBe(true);
        expect(result.changed).toBe(true);
        expect(result.changes).toEqual([
            {
                pointer: '/params/gain/import/digest',
                url: GAIN_URL,
                previous: null,
                digest: GAIN_DIGEST,
                error: null,
                changed: true,
                skipped: false,
            },
        ]);
        expect(result.text).toContain(GAIN_DIGEST);
        expect(result.text).toContain('# top level comment');
    });

    test('reports an unchanged import and leaves the text byte-for-byte', async () => {
        const parent = [
            'params:',
            '  gain:',
            '    import:',
            '      url: ./param.gain.yaml',
            `      digest: ${GAIN_DIGEST}`,
            '',
        ].join('\n');
        const load = mapLoad({ [ROOT]: parent, [GAIN_URL]: GAIN });

        const result = await pin(new URL(ROOT), { load });

        expect(result.ok).toBe(true);
        expect(result.changed).toBe(false);
        expect(result.changes[0].changed).toBe(false);
        expect(result.changes[0].previous).toBe(GAIN_DIGEST);
        expect(result.text).toBe(parent);
    });

    test('refreshes a stale digest', async () => {
        const stale = Buffer.alloc(32).toString('base64');
        const parent = [
            'params:',
            '  gain:',
            '    import:',
            '      url: ./param.gain.yaml',
            `      digest: ${stale}`,
            '',
        ].join('\n');
        const load = mapLoad({ [ROOT]: parent, [GAIN_URL]: GAIN });

        const result = await pin(new URL(ROOT), { load });

        expect(result.changed).toBe(true);
        expect(result.changes[0]).toMatchObject({ previous: stale, digest: GAIN_DIGEST, changed: true });
        expect(result.text).toContain(GAIN_DIGEST);
        expect(result.text).not.toContain(stale);
    });

    test('pins an import at the descriptor root', async () => {
        const parent = [
            'import:',
            '  url: ./param.gain.yaml',
            'name:',
            '  display_strings:',
            '    en: Override',
            '',
        ].join('\n');
        const load = mapLoad({ [ROOT]: parent, [GAIN_URL]: GAIN });

        const result = await pin(new URL(ROOT), { load });

        expect(result.changes).toHaveLength(1);
        expect(result.changes[0].pointer).toBe('/import/digest');
        expect(result.text).toContain(GAIN_DIGEST);
    });

    test('walks both params and commands at a device root', async () => {
        const device = [
            'params:',
            '  gain:',
            '    import:',
            '      url: ./param.gain.yaml',
            'commands:',
            '  reboot:',
            '    import:',
            '      url: ./command.reboot.yaml',
            '',
        ].join('\n');
        const load = mapLoad({
            [DEVICE_URL]: device,
            [GAIN_URL]: GAIN,
            [REBOOT_URL]: REBOOT,
        });

        const result = await pin(new URL(DEVICE_URL), { load });

        expect(result.ok).toBe(true);
        const byUrl = Object.fromEntries(result.changes.map((c) => [c.url, c.digest]));
        expect(byUrl[GAIN_URL]).toBe(GAIN_DIGEST);
        expect(byUrl[REBOOT_URL]).toBe(REBOOT_DIGEST);
    });

    test('reports an import that is missing its url and writes nothing', async () => {
        const parent = ['params:', '  bad:', '    import: {}', ''].join('\n');
        const load = mapLoad({ [ROOT]: parent });

        const result = await pin(new URL(ROOT), { load });

        expect(result.ok).toBe(false);
        expect(result.changed).toBe(false);
        expect(result.changes[0]).toMatchObject({ url: null, digest: null, error: 'import is missing its url' });
        expect(result.text).toBe(parent);
    });

    test('reports an import whose target cannot be loaded', async () => {
        const parent = [
            'params:',
            '  gone:',
            '    import:',
            '      url: ./missing.yaml',
            '',
        ].join('\n');
        const load = mapLoad({ [ROOT]: parent });

        const result = await pin(new URL(ROOT), { load });

        expect(result.ok).toBe(false);
        expect(result.changes[0].digest).toBeNull();
        expect(result.changes[0].error).toContain('missing.yaml');
        expect(result.text).toBe(parent);
    });

    test('omits the internal key path from reported changes', async () => {
        const parent = [
            'params:',
            '  gain:',
            '    import:',
            '      url: ./param.gain.yaml',
            '',
        ].join('\n');
        const load = mapLoad({ [ROOT]: parent, [GAIN_URL]: GAIN });

        const result = await pin(new URL(ROOT), { load });

        expect(result.changes[0]).not.toHaveProperty('path');
    });

    test('skips a local import by default and reports it as skipped', async () => {
        const parent = [
            'params:',
            '  gain:',
            '    import:',
            '      url: ./param.gain.yaml',
            '',
        ].join('\n');
        const load = mapLoad({ [LOCAL_ROOT]: parent, [LOCAL_GAIN_URL]: GAIN });

        const result = await pin(new URL(LOCAL_ROOT), { load });

        expect(result.ok).toBe(true);
        expect(result.changed).toBe(false);
        expect(result.changes[0]).toMatchObject({
            url: LOCAL_GAIN_URL,
            digest: null,
            error: null,
            changed: false,
            skipped: true,
        });
        expect(result.text).toBe(parent);
    });

    test('pins a remote import while skipping a local one', async () => {
        const parent = [
            'params:',
            '  local:',
            '    import:',
            '      url: ./param.gain.yaml',
            '  remote:',
            '    import:',
            `      url: ${REBOOT_URL}`,
            '',
        ].join('\n');
        const load = mapLoad({
            [LOCAL_ROOT]: parent,
            [LOCAL_GAIN_URL]: GAIN,
            [REBOOT_URL]: REBOOT,
        });

        const result = await pin(new URL(LOCAL_ROOT), { load });

        expect(result.ok).toBe(true);
        expect(result.changed).toBe(true);
        const byUrl = Object.fromEntries(result.changes.map((c) => [c.url, c]));
        expect(byUrl[LOCAL_GAIN_URL]).toMatchObject({ skipped: true, digest: null });
        expect(byUrl[REBOOT_URL]).toMatchObject({ skipped: false, digest: REBOOT_DIGEST });
        expect(result.text).toContain(REBOOT_DIGEST);
        expect(result.text).not.toContain(GAIN_DIGEST);
    });

    test('includeLocal pins a local import too', async () => {
        const parent = [
            'params:',
            '  gain:',
            '    import:',
            '      url: ./param.gain.yaml',
            '',
        ].join('\n');
        const load = mapLoad({ [LOCAL_ROOT]: parent, [LOCAL_GAIN_URL]: GAIN });

        const result = await pin(new URL(LOCAL_ROOT), { load, includeLocal: true });

        expect(result.ok).toBe(true);
        expect(result.changed).toBe(true);
        expect(result.changes[0]).toMatchObject({ url: LOCAL_GAIN_URL, digest: GAIN_DIGEST, changed: true, skipped: false });
        expect(result.text).toContain(GAIN_DIGEST);
    });

    test('wraps a transport failure on the descriptor itself as a LoadError', async () => {
        const load = async () => {
            throw new Error('boom');
        };
        await expect(pin(new URL(ROOT), { load })).rejects.toThrow('boom');
        await expect(pin(new URL(ROOT), { load })).rejects.toBeInstanceOf(loader.LoadError);
    });

    test('rejects a descriptor that will not parse', async () => {
        const load = mapLoad({ [ROOT]: 'name: "unterminated' });
        await expect(pin(new URL(ROOT), { load })).rejects.toThrow(/Invalid YAML/);
    });

    test('uses the default loader when no options are given and skips local imports', async () => {
        const url = pathToFileURL(path.resolve(__dirname, '../../examples/param.import.yaml'));

        const result = await pin(url);

        expect(result.ok).toBe(true);
        const onoff = result.changes.find((c) => c.url.endsWith('param.on_off.yaml'));
        expect(onoff).toMatchObject({ skipped: true, digest: null });
    });

    test('uses the default loader and, with includeLocal, digests a local import', async () => {
        const url = pathToFileURL(path.resolve(__dirname, '../../examples/param.import.yaml'));

        const result = await pin(url, { includeLocal: true });

        expect(result.ok).toBe(true);
        const onoff = result.changes.find((c) => c.url.endsWith('param.on_off.yaml'));
        expect(onoff.digest).toBe('U0R1rCOixZhOa/PPQ88NHzWcyEkxfppToo+n4GOT85I=');
    });
});

describe('assertWritable', () => {
    test('accepts a local file descriptor', () => {
        expect(() => assertWritable(new URL('file:///models/param.root.yaml'))).not.toThrow();
    });

    test('rejects a remote descriptor', () => {
        expect(() => assertWritable(new URL('https://example.com/param.root.yaml')))
            .toThrow('cannot write to a remote descriptor; writing pins requires a local file');
    });
});

describe('pin (unexpected load faults)', () => {
    afterEach(() => {
        jest.resetModules();
        jest.dontMock('../src/loader');
    });

    test('propagates a non-LoadError thrown while loading a target', async () => {
        jest.resetModules();
        jest.doMock('../src/loader', () => {
            const actual = jest.requireActual('../src/loader');
            return { ...actual, loadDescriptor: jest.fn().mockRejectedValue(new Error('unexpected')) };
        });
        const { pin: pinned } = require('../src/pin');
        const parent = [
            'params:',
            '  gain:',
            '    import:',
            '      url: ./param.gain.yaml',
            '',
        ].join('\n');
        const load = mapLoad({ [ROOT]: parent, 'file:///models/param.gain.yaml': GAIN });

        await expect(pinned(new URL(ROOT), { load })).rejects.toThrow('unexpected');
    });
});
