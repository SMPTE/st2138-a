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

/*
 * Render a resolution's provenance as a CycloneDX software bill of materials.
 */

'use strict';

const path = require('node:path');
const { decodeDigest } = require('./digest');

/**
 * @typedef {import('./types').ResolutionResult} ResolutionResult
 */

const SPEC_VERSION = '1.6';
const SCHEMA_URL = 'http://cyclonedx.org/schema/bom-1.6.schema.json';

/**
 * A CycloneDX component describing one loaded descriptor file. The sha256 is the
 * durable identity — a `file:///` URL is only a local source hint that means
 * nothing once the BOM outlives the files — so it lands in `hashes` (as the hex
 * CycloneDX expects) while the URL is recorded as an external reference.
 *
 * @param {string} href resolved URL the file was loaded from
 * @param {string} digest base64 sha256 of the file's loaded bytes
 * @returns {object} a CycloneDX component
 */
function component(href, digest) {
    return {
        type: 'file',
        name: path.basename(new URL(href).pathname),
        'bom-ref': href,
        hashes: [{ alg: 'SHA-256', content: decodeDigest(digest).toString('hex') }],
        externalReferences: [{ type: 'distribution', url: href }],
    };
}

/**
 * Render a resolution's provenance as a CycloneDX 1.6 BOM: the root descriptor
 * is the BOM's subject and every inlined file is a component. Output is
 * deterministic — no serial number, no timestamp — so it is reproducible and
 * diffable. Call only on a successful resolution, whose digests are then known.
 *
 * @param {ResolutionResult} result a valid resolution result
 * @param {string|URL} subject the root descriptor this BOM describes
 * @returns {object} a CycloneDX 1.6 BOM document
 */
function toCycloneDx(result, subject) {
    return {
        $schema: SCHEMA_URL,
        bomFormat: 'CycloneDX',
        specVersion: SPEC_VERSION,
        version: 1,
        metadata: { component: component(new URL(subject).href, result.digest) },
        components: result.imports.map((record) => component(record.url, record.digest)),
    };
}

module.exports = { toCycloneDx };
