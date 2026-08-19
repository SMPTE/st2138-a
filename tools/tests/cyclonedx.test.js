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
const { toCycloneDx } = require('../src/cyclonedx');
const pkg = require('../package.json');

// The provenance carries base64 digests; the BOM records the same hash as hex.
const b64 = (text) => crypto.createHash('sha256').update(text).digest('base64');
const hex = (text) => crypto.createHash('sha256').update(text).digest('hex');
// A component's bom-ref is its name plus the hex of its url
const ref = (name, href) => `${name}@${hex(href)}`;
// With no pipeline defaults, a component's provenance is explicitly Unknown.
const UNKNOWN = { supplier: { name: 'Unknown' }, version: 'Unknown', licenses: [{ license: { name: 'NOASSERTION' } }] };

// toCycloneDx returns a serialized JSON document; parse it back to inspect it.
const bomOf = (result, subject, options) => JSON.parse(toCycloneDx(result, subject, options));

describe('toCycloneDx', () => {
    test('renders a root-only resolution as a BOM with the root as subject and no components', () => {
        const result = { data: {}, diagnostics: [], valid: true, imports: [], dependencies: [], digest: b64('root') };

        const bom = bomOf(result, 'file:///models/device.example.yaml');

        expect(bom.bomFormat).toBe('CycloneDX');
        expect(bom.specVersion).toBe('1.6');
        // a local file leaks no path: identified by name + hash, no external ref
        expect(bom.metadata.component).toEqual({
            type: 'file',
            name: 'device.example.yaml',
            'bom-ref': ref('device.example.yaml', 'file:///models/device.example.yaml'),
            hashes: [{ alg: 'SHA-256', content: hex('root') }],
            ...UNKNOWN
        });
        expect(bom.components ?? []).toEqual([]);
    });

    test('records this tool as the BOM producer', () => {
        const result = { imports: [], dependencies: [], digest: b64('root') };

        const bom = bomOf(result, 'file:///models/device.yaml');

        expect(bom.metadata.tools).toEqual([
            { vendor: 'SMPTE', name: pkg.name, version: pkg.version }
        ]);
    });

    test('records the pre-build lifecycle phase', () => {
        const result = { imports: [], dependencies: [], digest: b64('root') };

        const bom = bomOf(result, 'file:///models/device.yaml');

        expect(bom.metadata.lifecycles).toEqual([{ phase: 'pre-build' }]);
    });

    test('records a supplied author as the entity that generated the SBOM', () => {
        const result = { imports: [], dependencies: [], digest: b64('root') };

        const bom = bomOf(result, 'file:///models/device.yaml', {
            author: { name: 'Acme Corporation', email: 'sbom@acme.example' }
        });

        expect(bom.metadata.authors).toEqual([
            { name: 'Acme Corporation', email: 'sbom@acme.example' }
        ]);
    });

    test('records the author as Unknown when none is supplied', () => {
        const result = { imports: [], dependencies: [], digest: b64('root') };

        const bom = bomOf(result, 'file:///models/device.yaml');

        expect(bom.metadata.authors).toEqual([{ name: 'Unknown' }]);
    });

    test('carries a urn:uuid serial number and a timestamp', () => {
        const result = { imports: [], dependencies: [], digest: b64('root') };

        const bom = bomOf(result, new URL('file:///models/device.yaml'));

        expect(bom.serialNumber).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
        expect(Number.isNaN(Date.parse(bom.metadata.timestamp))).toBe(false);
    });

    test('renders each inlined file as a component identified by its content hash', () => {
        const result = {
            imports: [
                { url: 'file:///models/param.on_off.yaml', digest: b64('onoff'), dependencies: [] },
                { url: 'file:///models/param.shared.yaml', digest: b64('shared'), dependencies: [] }
            ],
            dependencies: [],
            digest: b64('root')
        };

        const bom = bomOf(result, 'file:///models/device.yaml');

        expect(bom.components).toEqual([
            {
                type: 'file',
                name: 'param.on_off.yaml',
                'bom-ref': ref('param.on_off.yaml', 'file:///models/param.on_off.yaml'),
                hashes: [{ alg: 'SHA-256', content: hex('onoff') }],
                ...UNKNOWN
            },
            {
                type: 'file',
                name: 'param.shared.yaml',
                'bom-ref': ref('param.shared.yaml', 'file:///models/param.shared.yaml'),
                hashes: [{ alg: 'SHA-256', content: hex('shared') }],
                ...UNKNOWN
            }
        ]);
    });

    test('records an external distribution reference only for remote imports', () => {
        // a remote URL is a real distribution point; a local path is not, and
        // recording it would leak the author's filesystem
        const result = {
            imports: [
                { url: 'https://models.example.com/param.remote.yaml', digest: b64('remote'), dependencies: [] },
                { url: 'file:///models/param.local.yaml', digest: b64('local'), dependencies: [] }
            ],
            dependencies: [],
            digest: b64('root')
        };

        const bom = bomOf(result, 'file:///models/device.yaml');
        const [remote, local] = bom.components;

        expect(remote.externalReferences).toEqual([
            { url: 'https://models.example.com/param.remote.yaml', type: 'distribution' }
        ]);
        expect(local).not.toHaveProperty('externalReferences');
    });

    test('applies pipeline provenance defaults to local files, leaving remote imports Unknown', () => {
        // local files share this repo's origin, so they inherit the defaults;
        // a remote import cannot be spoken for and stays explicitly Unknown
        const result = {
            imports: [
                { url: 'https://models.example.com/param.remote.yaml', digest: b64('remote'), dependencies: [] },
                { url: 'file:///models/param.local.yaml', digest: b64('local'), dependencies: [] }
            ],
            dependencies: [],
            digest: b64('root')
        };

        const bom = bomOf(result, 'file:///models/device.yaml', {
            localProvenance: { producer: 'SMPTE', license: 'BSD-3-Clause', version: '1.2.0' }
        });
        const [remote, local] = bom.components;

        expect(local.supplier).toEqual({ name: 'SMPTE' });
        expect(local.version).toBe('1.2.0');
        expect(local.licenses).toEqual([{ license: { id: 'BSD-3-Clause' } }]);
        expect(remote.supplier).toEqual({ name: 'Unknown' });
        expect(remote.version).toBe('Unknown');
        expect(remote.licenses).toEqual([{ license: { name: 'NOASSERTION' } }]);
    });

    test('descriptor-declared provenance overrides the defaults and speaks for remote files', () => {
        // a file self-asserts its provenance in its comments; that wins over the
        // pipeline default for a local file, and is the only authority for a
        // remote one, which the pipeline cannot speak for
        const result = {
            provenance: { producer: 'SMPTE', license: 'BSD-3-Clause', version: '2.0.0', copyright: '2026 SMPTE' },
            imports: [
                {
                    url: 'https://models.example.com/param.remote.yaml',
                    digest: b64('remote'),
                    dependencies: [],
                    provenance: { producer: 'Vendor Inc', license: 'MIT', version: '9.9', copyright: '2025 Vendor' }
                }
            ],
            dependencies: [],
            digest: b64('root')
        };

        const bom = bomOf(result, 'file:///models/device.yaml', {
            localProvenance: { producer: 'Pipeline Co', license: 'Apache-2.0', version: '0.0.1' }
        });
        const root = bom.metadata.component;
        const [remote] = bom.components;

        // the local root's own declaration beats the pipeline default
        expect(root.supplier).toEqual({ name: 'SMPTE' });
        expect(root.version).toBe('2.0.0');
        expect(root.licenses).toEqual([{ license: { id: 'BSD-3-Clause' } }]);
        expect(root.copyright).toBe('2026 SMPTE');
        // the remote file speaks for itself through its own declaration
        expect(remote.supplier).toEqual({ name: 'Vendor Inc' });
        expect(remote.version).toBe('9.9');
        expect(remote.licenses).toEqual([{ license: { id: 'MIT' } }]);
        expect(remote.copyright).toBe('2025 Vendor');
    });

    test('types a declared license as an SPDX id, an expression, or a free-text name', () => {
        // a supported SPDX id becomes a typed `id`; an AND/OR/WITH expression
        // becomes an `expression`; anything else falls back to a free-text `name`
        const result = {
            imports: [
                { url: 'file:///models/id.yaml', digest: b64('id'), dependencies: [], provenance: { license: 'BSD-3-Clause' } },
                { url: 'file:///models/expr.yaml', digest: b64('expr'), dependencies: [], provenance: { license: 'MIT OR CC0-1.0' } },
                { url: 'file:///models/named.yaml', digest: b64('named'), dependencies: [], provenance: { license: 'Totally Custom' } }
            ],
            dependencies: [],
            digest: b64('root')
        };

        const [id, expr, named] = bomOf(result, 'file:///models/device.yaml').components;

        expect(id.licenses).toEqual([{ license: { id: 'BSD-3-Clause' } }]);
        expect(expr.licenses).toEqual([{ expression: 'MIT OR CC0-1.0' }]);
        expect(named.licenses).toEqual([{ license: { name: 'Totally Custom' } }]);
    });

    test('emits a dependency graph, with a diamond target referenced once', () => {
        // device -> a, b ; a -> shared ; b -> shared ; shared -> (none)
        const result = {
            imports: [
                { url: 'file:///models/a.yaml', digest: b64('a'), dependencies: ['file:///models/shared.yaml'] },
                { url: 'file:///models/shared.yaml', digest: b64('shared'), dependencies: [] },
                { url: 'file:///models/b.yaml', digest: b64('b'), dependencies: ['file:///models/shared.yaml'] }
            ],
            dependencies: ['file:///models/a.yaml', 'file:///models/b.yaml'],
            digest: b64('root')
        };

        const bom = bomOf(result, 'file:///models/device.yaml');

        expect(bom.dependencies).toEqual([
            { ref: ref('device.yaml', 'file:///models/device.yaml'), dependsOn: [ref('a.yaml', 'file:///models/a.yaml'), ref('b.yaml', 'file:///models/b.yaml')] },
            { ref: ref('a.yaml', 'file:///models/a.yaml'), dependsOn: [ref('shared.yaml', 'file:///models/shared.yaml')] },
            { ref: ref('shared.yaml', 'file:///models/shared.yaml') },
            { ref: ref('b.yaml', 'file:///models/b.yaml'), dependsOn: [ref('shared.yaml', 'file:///models/shared.yaml')] }
        ]);
    });

    test('gives distinct bom-refs to same-name, same-content files at different paths', () => {
        // identical bytes (same digest) and basename at different URLs are still
        // distinct components; the ref is keyed on the URL so they cannot collide
        const result = {
            imports: [
                { url: 'file:///models/a/param.on_off.yaml', digest: b64('same'), dependencies: [] },
                { url: 'file:///models/b/param.on_off.yaml', digest: b64('same'), dependencies: [] }
            ],
            dependencies: ['file:///models/a/param.on_off.yaml', 'file:///models/b/param.on_off.yaml'],
            digest: b64('root')
        };

        const bom = bomOf(result, 'file:///models/device.yaml');

        const refA = ref('param.on_off.yaml', 'file:///models/a/param.on_off.yaml');
        const refB = ref('param.on_off.yaml', 'file:///models/b/param.on_off.yaml');
        expect(refA).not.toBe(refB);
        expect(bom.components.map((c) => c['bom-ref'])).toEqual([refA, refB]);
        // each edge resolves to the right instance despite identical content
        expect(bom.dependencies).toEqual([
            { ref: ref('device.yaml', 'file:///models/device.yaml'), dependsOn: [refA, refB] },
            { ref: refA },
            { ref: refB }
        ]);
    });
});
