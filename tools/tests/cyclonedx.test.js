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

// The provenance carries base64 digests; the BOM records the same hash as hex.
const b64 = (text) => crypto.createHash('sha256').update(text).digest('base64');
const hex = (text) => crypto.createHash('sha256').update(text).digest('hex');

describe('toCycloneDx', () => {
    test('renders a root-only resolution as a BOM with the root as subject and no components', () => {
        const result = { data: {}, diagnostics: [], valid: true, imports: [], digest: b64('root') };

        const bom = toCycloneDx(result, 'file:///models/device.example.yaml');

        expect(bom).toEqual({
            $schema: 'http://cyclonedx.org/schema/bom-1.6.schema.json',
            bomFormat: 'CycloneDX',
            specVersion: '1.6',
            version: 1,
            metadata: {
                component: {
                    type: 'file',
                    name: 'device.example.yaml',
                    'bom-ref': 'file:///models/device.example.yaml',
                    hashes: [{ alg: 'SHA-256', content: hex('root') }],
                    externalReferences: [
                        { type: 'distribution', url: 'file:///models/device.example.yaml' }
                    ]
                }
            },
            components: []
        });
    });

    test('omits the volatile serial number and timestamp so the BOM is reproducible', () => {
        const result = { imports: [], digest: b64('root') };

        const bom = toCycloneDx(result, new URL('file:///models/device.yaml'));

        expect(bom).not.toHaveProperty('serialNumber');
        expect(bom.metadata).not.toHaveProperty('timestamp');
    });

    test('renders each inlined file as a component identified by its content hash', () => {
        const result = {
            imports: [
                { url: 'file:///models/param.on_off.yaml', digest: b64('onoff') },
                { url: 'file:///models/param.shared.yaml', digest: b64('shared') }
            ],
            digest: b64('root')
        };

        const bom = toCycloneDx(result, 'file:///models/device.yaml');

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
});
