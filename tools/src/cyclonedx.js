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
const { randomUUID } = require('node:crypto');
const { Models, Enums, Spec, Serialize, Contrib } = require('@cyclonedx/cyclonedx-library');
const spdxExpressionParse = require('spdx-expression-parse');
const { decodeDigest } = require('./digest');
const { isRemote, toUrl } = require('./urls');
const pkg = require('../package.json');

/**
 * @typedef {import('./types').ResolutionResult} ResolutionResult
 * @typedef {import('./types').CycloneDxOptions} CycloneDxOptions
 * @typedef {import('./types').Provenance} Provenance
 */

const SHA256 = Enums.HashAlgorithm['SHA-256'];

// Maps a license string to the right CycloneDX shape: a supported SPDX id becomes
// a typed `id` (case-fixed), a valid SPDX expression (AND/OR/WITH) becomes an
// `expression`, and anything else falls back to a free-text `name`.
const licenseFactory = new Contrib.License.Factories.LicenseFactory(spdxExpressionParse);

/**
 * Build a CycloneDX component for one loaded descriptor file. The sha256 is the
 * durable identity, so it lands in `hashes` (as the hex CycloneDX expects) and
 * also forms the `bom-ref` — a document-internal id — as `name@sha256:<hex>`,
 * which stays unique without leaking the author's local filesystem path. Only a
 * remote URL is recorded as an external reference: it is a real distribution
 * point, whereas a `file:` path is machine-specific and would leak a home
 * directory while resolving nowhere off the authoring machine.
 *
 * Producer, license, version, and copyright are self-assertions about the file.
 * A file's own descriptor-declared provenance wins; failing that, a local file
 * inherits the pipeline's env-supplied defaults, since it shares this repo's
 * origin, while a remote file cannot be spoken for by the pipeline. Anything
 * still unset is recorded as an explicit `Unknown` / `NOASSERTION` rather than
 * omitted, per CISA guidance; copyright, which has no default, is omitted when
 * undeclared.
 *
 * @param {string} href resolved URL the file was loaded from
 * @param {string} digest base64 sha256 of the file's loaded bytes
 * @param {{ producer?: string, license?: string, version?: string }} localProvenance
 *   provenance defaults applied only to local (`file:`) components
 * @param {Provenance} [declared] provenance the file declares about itself, which
 *   overrides the pipeline defaults; applies to remote files too, as it is the
 *   file's own assertion
 * @returns {Models.Component} a CycloneDX component
 */
function component(href, digest, localProvenance, declared = {}) {
    const url = new URL(href);
    const name = path.basename(url.pathname);
    const hex = decodeDigest(digest).toString('hex');
    const comp = new Models.Component(Enums.ComponentType.File, name, { bomRef: `${name}@sha256:${hex}` });
    comp.hashes.set(SHA256, hex);
    const remote = isRemote(url);
    if (remote) {
        comp.externalReferences.add(new Models.ExternalReference(href, Enums.ExternalReferenceType.Distribution));
    }

    // A file speaks for itself; the pipeline defaults only fill in local files it
    // has not spoken for. A remote file the pipeline cannot vouch for falls back
    // to explicit Unknown unless the file itself declared its provenance.
    const base = remote ? {} : localProvenance;
    comp.supplier = new Models.OrganizationalEntity({ name: declared.producer || base.producer || 'Unknown' });
    comp.version = declared.version || base.version || 'Unknown';
    comp.licenses.add(licenseFactory.makeFromString(declared.license || base.license || 'NOASSERTION'));
    if (declared.copyright) {
        comp.copyright = declared.copyright;
    }

    return comp;
}

/**
 * Render a resolution's provenance as a CycloneDX 1.6 BOM: the root descriptor
 * is the BOM's subject, every inlined file is a component, and each file's
 * direct imports become dependency-graph edges. The BOM carries a random serial
 * number and a timestamp, and records this tool as its producer. The author
 * names the entity that generated the SBOM; when none is supplied it is recorded
 * as an explicit "Unknown" rather than omitted, since the SBOM Author is a
 * required element. Component producer/license/version come from the caller's
 * local defaults (applied to `file:` components only); anything unset is likewise
 * an explicit "Unknown"/"NOASSERTION". Call only on a successful resolution,
 * whose digests are then known.
 *
 * @param {ResolutionResult} result a valid resolution result
 * @param {string|URL} subject the root descriptor this BOM describes
 * @param {CycloneDxOptions} [options] SBOM rendering options, e.g. the author
 * @returns {string} a serialized CycloneDX 1.6 JSON BOM document
 */
function toCycloneDx(result, subject, options = {}) {
    const localProvenance = options.localProvenance || {};
    const rootHref = toUrl(subject).href;
    const root = component(rootHref, result.digest, localProvenance, result.provenance);

    // Index every file's component by URL so edges can reference them by bom-ref.
    const byUrl = new Map([[rootHref, root]]);
    const components = result.imports.map((record) => {
        const comp = component(record.url, record.digest, localProvenance, record.provenance);
        byUrl.set(record.url, comp);
        return comp;
    });

    // Wire the graph: each file depends on the files it imports directly. Every
    // dependency URL is itself an inlined file, so it always has a component.
    const link = (comp, dependencies) => {
        for (const url of dependencies) {
            comp.dependencies.add(byUrl.get(url).bomRef);
        }
    };
    link(root, result.dependencies);
    for (const record of result.imports) {
        link(byUrl.get(record.url), record.dependencies);
    }

    const metadata = new Models.Metadata({ component: root, timestamp: new Date() });
    metadata.tools.tools.add(new Models.Tool({ vendor: 'SMPTE', name: pkg.name, version: pkg.version }));
    // The SBOM is built from source descriptors, before any product build.
    metadata.lifecycles.add(Enums.LifecyclePhase.PreBuild);
    // The SBOM Author is required; mark it explicitly Unknown rather than omit.
    const authorName = options.author?.name || 'Unknown';
    metadata.authors.add(new Models.OrganizationalContact({ name: authorName, email: options.author?.email }));

    const bom = new Models.Bom({ metadata });
    bom.serialNumber = `urn:uuid:${randomUUID()}`;
    for (const comp of components) {
        bom.components.add(comp);
    }

    const serializer = new Serialize.JsonSerializer(new Serialize.JSON.Normalize.Factory(Spec.Spec1dot6));
    return serializer.serialize(bom, { space: 2 });
}

module.exports = { toCycloneDx };
