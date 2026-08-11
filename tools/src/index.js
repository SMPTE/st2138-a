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

const Validator = require('./validator');
const { resolve: resolveTree } = require('./resolve');
const { toCycloneDx } = require('./cyclonedx');
const { defaultLoad } = require('./loader');
const { computeDigest } = require('./digest');
const { toUrl, schemaNameFromUrl } = require('./urls');

/**
 * @typedef {import('./types').ValidateOptions} ValidateOptions
 * @typedef {import('./types').ResolveOptions} ResolveOptions
 * @typedef {import('./types').DigestOptions} DigestOptions
 * @typedef {import('./types').ValidationResult} ValidationResult
 * @typedef {import('./types').ResolutionResult} ResolutionResult
 * @typedef {import('./types').Diagnostic} Diagnostic
 * 
 */

let defaultEngine;

/**
 * Return the shared Validator engine, building it once on first use. The engine
 * holds the compiled AJV schema, so reusing it avoids recompiling per call.
 * @returns {Validator}
 */
function getEngine() {
    return (defaultEngine ??= new Validator());
}

/**
 * Format a single diagnostic (from a validation result) as a human-readable
 * line, e.g. `ERROR: must be string at /params/foo on lines 5-7`.
 * @param {Diagnostic} diagnostic
 * @returns {string}
 */
function formatDiagnostic(diagnostic) {
    const lineInfo = diagnostic.lines
        ? ` on lines ${diagnostic.lines.start}-${diagnostic.lines.end}`
        : '';
    return `${diagnostic.level.toUpperCase()}: ${diagnostic.message} at ${diagnostic.instancePath}${lineInfo}`;
}

/**
 * Print an array of diagnostics, one formatted line each, via console.log.
 * @param {Diagnostic[]} diagnostics
 * @returns {void}
 */
function printDiagnostics(diagnostics) {
    for (const diagnostic of diagnostics) {
        console.log(formatDiagnostic(diagnostic));
    }
}

/**
 * Validate a device model or parameter descriptor against the ST 2138-a schema.
 * @param {string|URL} input path or URL to a .json or .yaml descriptor
 * @param {ValidateOptions} options
 * @returns {Promise<ValidationResult>}
 */
async function validate(input, options = {}) {
    const url = toUrl(input);
    const schemaName = schemaNameFromUrl(url);
    const loadOpts = {
        digest: options.digest ?? null,
        load: options.load,
    };
    const checkOpts = {
        disableMandatoryParams: options.disableMandatoryParams || false,
        disableNestedValueChecks: options.disableNestedValueChecks || false,
        disableScopeChecks: options.disableScopeChecks || false,
    };
    return getEngine().validate(schemaName, url, loadOpts, checkOpts);
}

/**
 * Resolve a descriptor's `import` directives into a single self-contained tree.
 * Each fragment is validated as it is inlined and the merged whole is validated
 * once more, so the result carries the same diagnostics a `validate` would plus
 * a record of every file that was pulled in.
 * @param {string|URL} input path or URL to a .json or .yaml descriptor
 * @param {ResolveOptions} options
 * @returns {Promise<ResolutionResult>}
 */
async function resolve(input, options = {}) {
    const url = toUrl(input);
    const checkOpts = {
        disableMandatoryParams: options.disableMandatoryParams || false,
        disableNestedValueChecks: options.disableNestedValueChecks || false,
        disableScopeChecks: options.disableScopeChecks || false,
    };
    const engine = getEngine();
    // The resolver validates in-memory data. Per fragment it runs only the
    // gate-phase checks (schema, digest) it depends on to descend and load
    // safely; the report-phase checks run once, on the fully resolved model.
    const validate = (schemaName, data, sourceMap) =>
        engine.validateData(schemaName, data, sourceMap, checkOpts, 'gate');
    const validateFinal = (schemaName, data, sourceMap) =>
        engine.validateData(schemaName, data, sourceMap, checkOpts, 'report');
    return resolveTree(url, {
        validate,
        validateFinal,
        load: options.load,
        digest: options.digest ?? null,
        disableTemplateExpansion: options.disableTemplateExpansion || false,
    });
}

/**
 * Compute the base64 sha256 digest of a descriptor's raw bytes. The bytes are
 * hashed as loaded — not parsed or validated — so this reports the digest of
 * any file, and it is the value an `import` directive pins its target against.
 * @param {string|URL} input path or URL to a descriptor
 * @param {DigestOptions} options
 * @returns {Promise<string>} the base64-encoded sha256 digest
 */
async function digest(input, options = {}) {
    const url = toUrl(input);
    const load = options.load ?? defaultLoad;
    return computeDigest(await load(url));
}

module.exports = { validate, resolve, digest, toCycloneDx, formatDiagnostic, printDiagnostics };

