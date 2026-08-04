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

// toCycloneDx returns a serialized JSON document; parse it back to inspect it.
const bomOf = (result, subject) => JSON.parse(toCycloneDx(result, subject));

describe('toCycloneDx', () => {
    test('renders a root-only resolution as a BOM with the root as subject and no components', () => {
        const result = { data: {}, diagnostics: [], valid: true, imports: [], dependencies: [], digest: b64('root') };

        const bom = bomOf(result, 'file:///models/device.example.yaml');

        expect(bom.bomFormat).toBe('CycloneDX');
        expect(bom.specVersion).toBe('1.6');
        expect(bom.metadata.component).toEqual({
            type: 'file',
            name: 'device.example.yaml',
            'bom-ref': 'file:///models/device.example.yaml',
            hashes: [{ alg: 'SHA-256', content: hex('root') }],
            externalReferences: [
                { type: 'distribution', url: 'file:///models/device.example.yaml' }
            ]
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
                'bom-ref': 'file:///models/param.on_off.yaml',
                hashes: [{ alg: 'SHA-256', content: hex('onoff') }],
                externalReferences: [
                    { type: 'distribution', url: 'file:///models/param.on_off.yaml' }
                ]
            },
            {
                type: 'file',
                name: 'param.shared.yaml',
                'bom-ref': 'file:///models/param.shared.yaml',
                hashes: [{ alg: 'SHA-256', content: hex('shared') }],
                externalReferences: [
                    { type: 'distribution', url: 'file:///models/param.shared.yaml' }
                ]
            }
        ]);
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
            { ref: 'file:///models/device.yaml', dependsOn: ['file:///models/a.yaml', 'file:///models/b.yaml'] },
            { ref: 'file:///models/a.yaml', dependsOn: ['file:///models/shared.yaml'] },
            { ref: 'file:///models/shared.yaml' },
            { ref: 'file:///models/b.yaml', dependsOn: ['file:///models/shared.yaml'] }
        ]);
    });
});
