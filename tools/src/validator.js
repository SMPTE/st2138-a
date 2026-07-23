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

const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats').default;

const jsonMap = require('json-source-map');
const schema = require('./data/device.json');
const checks = require('./checks');
const loader = require('./loader');

/**
 * @typedef {import('./types').ValidateOptions} ValidateOptions
 * @typedef {import('./types').ValidationResult} ValidationResult
 * @typedef {import('./types').Diagnostic} Diagnostic
 * @typedef {import('./types').CheckOptions} CheckOptions
 * @typedef {import('./types').Loader} Loader
 * @typedef {import('./checks').RawError} RawError
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
    }

    addSchemas(genus) {
        const schemaMap = jsonMap.stringify(schema, null, 2);
        for (const species in schema[genus]) {
            if (!Object.prototype.hasOwnProperty.call(schema[genus], species)) continue;
            if (species.startsWith('$comment')) continue;

            try {
                this.ajv.addSchema(schema[genus][species], `#/${genus}/${species}`);
            } catch (err) {
                const errorPointer = schemaMap.pointers[`/${genus}/${species}`];
                throw new Error(`${err.message} at #/${genus}/${species} on lines ${errorPointer.value.line}-${errorPointer.valueEnd.line}`);
            }
        }
    }

    /**
     * Validate a descriptor against the named schema and run post-schema checks.
     * Collects findings as structured diagnostics rather than printing them, so
     * callers (the CLI, resolve) decide how to surface them.
     *
     * @param {string} schemaName schema to apply (e.g. `device`, `param`)
     * @param {URL} url location of the descriptor to load
     * @param {object} [loadOpts] descriptor loading options
     * @param {string} [loadOpts.digest] optional sha256 digest to verify the input against
     * @param {Loader} [loadOpts.load] custom transport for loading the descriptor
     * @param {CheckOptions} [checkOpts] flags to disable individual post-schema checks
     * @returns {Promise<ValidationResult>}
     */
    async validate(schemaName, url, loadOpts = {}, checkOpts = {}) {
        const { data, sourceMap } = await loader.loadDescriptor(url, loadOpts || {});

        const isDeviceSchema = schemaName.startsWith('device');
        if (!isDeviceSchema && !(schemaName in schema.$defs)) {
            throw { error: 2, message: `Could not find ${schemaName} in schema definition file.` };
        }

        let valid, errors;
        if (isDeviceSchema) {
            const validate = this.ajv.compile(schema);
            valid = validate(data);
            errors = validate.errors;
        } else {
            valid = this.ajv.validate(schema.$defs[schemaName], data);
            errors = this.ajv.errors;
        }

        if (!valid) {
            return { valid: false, diagnostics: Validator.toDiagnostics(errors, sourceMap), data };
        }

        const checkErrors = checks.runChecks(data, { ...checkOpts, schemaName });
        const diagnostics = Validator.toDiagnostics(checkErrors, sourceMap);
        const hasError = checkErrors.some(err => err.type === undefined || err.type === checks.ERROR);

        return { valid: !hasError, diagnostics, data };
    }

    /**
     * Map raw AJV/check errors to structured diagnostics, resolving source line
     * ranges from the source map where available.
     *
     * @param {RawError[]} errors
     * @param {object} sourceMap json-source-map pointers for the validated document
     * @returns {Diagnostic[]}
     */
    static toDiagnostics(errors, sourceMap) {
        return errors.map((err) => {
            const level = err.type === checks.WARNING ? checks.WARNING : checks.ERROR;
            const pointer = sourceMap.pointers[err.instancePath];
            const lines = pointer
                ? { start: pointer.value.line, end: pointer.valueEnd.line }
                : null;
            return { level, message: err.message, instancePath: err.instancePath, lines };
        });
    }
}

module.exports = Validator;
