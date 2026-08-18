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

const fs = require('node:fs');
const path = require('node:path');

const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats').default;

const schema = require('./data/device.json');
const checks = require('./checks');
const loader = require('./loader');
const sourcemap = require('./sourcemap');

/**
 * @typedef {import('./types').ValidateOptions} ValidateOptions
 * @typedef {import('./types').ValidationResult} ValidationResult
 * @typedef {import('./types').Diagnostic} Diagnostic
 * @typedef {import('./types').CheckOptions} CheckOptions
 * @typedef {import('./types').Loader} Loader
 * @typedef {import('./checks').RawError} RawError
 * @typedef {import('./sourcemap').SourceMap} SourceMap
 */

class Validator {
    constructor() {
        this.ajv = new Ajv({
            strict: true,
            strictSchema: true,
            strictRequired: true,
            unevaluated: true
        });
        addFormats(this.ajv);

        this.addSchemas('$defs');
        // Compile the device root once and reuse it; the param/command sub-schemas
        // are already cached by addSchemas, but the root has no id to reference.
        this.deviceValidate = this.ajv.compile(schema);
    }

    addSchemas(genus) {
        for (const species in schema[genus]) {
            if (!Object.prototype.hasOwnProperty.call(schema[genus], species)) continue;
            if (species.startsWith('$comment')) continue;

            try {
                this.ajv.addSchema(schema[genus][species], `#/${genus}/${species}`);
            } catch (err) {
                // cold maintainer path: the bundled schema itself is malformed.
                // Resolve the offending definition's real line range on demand;
                // if the on-disk file and the loaded schema have drifted the
                // pointer may not resolve, so degrade to no line info rather
                // than masking the real error with a null dereference.
                const raw = fs.readFileSync(path.join(__dirname, 'data', 'device.json'), 'utf8');
                const lines = sourcemap.parse(raw).sourceMap.linesFor(`/${genus}/${species}`);
                const where = lines ? ` on lines ${lines.start}-${lines.end}` : '';
                throw new Error(`${err.message} at #/${genus}/${species}${where}`);
            }
        }
    }

    /**
     * Load a descriptor from a URL and validate it. Thin I/O wrapper around
     * {@link Validator#validateData}: it resolves the transport, then hands the
     * parsed data and its source map to the pure validation path.
     *
     * @param {string} schemaName schema to apply (e.g. `device`, `param`)
     * @param {URL} url location of the descriptor to load
     * @param {object} [loadOpts] descriptor loading options
     * @param {string} [loadOpts.digest] optional base64 sha256 digest to verify the input against
     * @param {Loader} [loadOpts.load] custom transport for loading the descriptor
     * @param {CheckOptions} [checkOpts] flags to disable individual post-schema checks
     * @returns {Promise<ValidationResult>}
     */
    async validate(schemaName, url, loadOpts = {}, checkOpts) {
        const { data, sourceMap } = await loader.loadDescriptor(url, loadOpts || {});
        return this.validateData(schemaName, data, sourceMap, checkOpts);
    }

    /**
     * Validate already-loaded data against the named schema and run post-schema
     * checks. Pure and synchronous: no I/O, so callers that already hold the
     * data (the resolver, in-memory callers) can validate without a transport.
     * Collects findings as structured diagnostics rather than printing them, so
     * callers (the CLI, resolve) decide how to surface them.
     *
     * @param {string} schemaName schema to apply (e.g. `device`, `param`)
     * @param {unknown} data the parsed descriptor to validate
     * @param {SourceMap} sourceMap resolves diagnostic pointers to source lines
     * @param {CheckOptions} [checkOpts] flags to disable individual post-schema checks
     * @param {('all'|'gate'|'report')} [phase] which phase of post-schema checks to run
     * @returns {ValidationResult}
     */
    validateData(schemaName, data, sourceMap, checkOpts = {}, phase = 'all') {
        const isDeviceSchema = schemaName === 'device';
        if (!isDeviceSchema && !(schemaName in schema.$defs)) {
            throw { error: 2, message: `Could not find ${schemaName} in schema definition file.` };
        }

        let valid, errors;
        if (isDeviceSchema) {
            valid = this.deviceValidate(data);
            errors = this.deviceValidate.errors;
        } else {
            valid = this.ajv.validate(schema.$defs[schemaName], data);
            errors = this.ajv.errors;
        }

        if (!valid) {
            // Invalid results carry no data to trust; the contract is binary,
            // read `data` only when `valid`. Hand back an empty object so the
            // type stays honest (never null, never a non-object scalar root).
            return { valid: false, diagnostics: Validator.toDiagnostics(errors, sourceMap), data: {} };
        }

        const checkErrors = checks.runChecks(data, { ...checkOpts, schemaName }, phase);
        const diagnostics = Validator.toDiagnostics(checkErrors, sourceMap);
        valid = !checkErrors.some(err => err.type === undefined || err.type === checks.ERROR);

        return { valid, diagnostics, data: valid ? data : {} };
    }

    /**
     * Map raw AJV/check errors to structured diagnostics, resolving source line
     * ranges on demand from the source map where available.
     *
     * @param {RawError[]} errors
     * @param {SourceMap} sourceMap
     * @returns {Diagnostic[]}
     */
    static toDiagnostics(errors, sourceMap) {
        return errors.map((err) => {
            const level = err.type === checks.WARNING ? checks.WARNING : checks.ERROR;
            const lines = sourceMap.linesFor(err.instancePath);
            return { level, message: err.message, instancePath: err.instancePath, lines };
        });
    }
}

module.exports = Validator;
