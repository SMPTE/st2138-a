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
// A component's bom-ref is its name plus the content hash, not its path.
const ref = (name, text) => `${name}@sha256:${hex(text)}`;
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
            'bom-ref': ref('device.example.yaml', 'root'),
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
                'bom-ref': ref('param.on_off.yaml', 'onoff'),
                hashes: [{ alg: 'SHA-256', content: hex('onoff') }],
                ...UNKNOWN
            },
            {
                type: 'file',
                name: 'param.shared.yaml',
                'bom-ref': ref('param.shared.yaml', 'shared'),
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
        expect(local.licenses).toEqual([{ license: { name: 'BSD-3-Clause' } }]);
        expect(remote.supplier).toEqual({ name: 'Unknown' });
        expect(remote.version).toBe('Unknown');
        expect(remote.licenses).toEqual([{ license: { name: 'NOASSERTION' } }]);
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
            { ref: ref('device.yaml', 'root'), dependsOn: [ref('a.yaml', 'a'), ref('b.yaml', 'b')] },
            { ref: ref('a.yaml', 'a'), dependsOn: [ref('shared.yaml', 'shared')] },
            { ref: ref('shared.yaml', 'shared') },
            { ref: ref('b.yaml', 'b'), dependsOn: [ref('shared.yaml', 'shared')] }
        ]);
    });
});
