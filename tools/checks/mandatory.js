/*
 * Copyright © MMXXV 2026 by the Society of Motion Picture and Television Engineers
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

const REQUIRED_PARAMS = [
    "name",
    "vendor",
    "version",
    "catena_sdk",
    "catena_sdk_version",
    "serial_number"
];

const REQUIRED_SCOPE = "st2138:mon";

/**
 * Derive the effective scope for a parameter by walking up the scope chain.
 * @param {object} param the sub-parameter descriptor
 * @param {string|undefined} productScope access_scope on the product param
 * @param {string|undefined} defaultScope device-level default_scope
 * @returns {string} "st2138:mon" if valid, "INVALID" otherwise
 */
function getDerivedScope(param, productScope, defaultScope) {
    const scope = param.access_scope || productScope || defaultScope || REQUIRED_SCOPE;
    return scope === REQUIRED_SCOPE ? scope : "INVALID";
}

/**
 * Validates that all mandatory product parameters and scopes are present
 * and have valid values.
 * @param {object} deviceDesc the complete device model object
 * @param {object} opts
 * @param {string} opts.schemaName the schema being validated
 * @param {boolean} opts.disableMandatoryParams if true, skip this check
 * @returns {Array<{message: string, instancePath: string}>} array of errors
 *   (empty if valid). Each entry carries an instancePath suitable for
 *   source-map lookup so callers can report line numbers.
 */
function validateRequiredParamsAndScopes(deviceDesc, opts) {
    if (opts.disableMandatoryParams || opts.schemaName !== 'device') return [];

    const errors = [];

    if (!deviceDesc || !deviceDesc.params || !deviceDesc.params.product) {
        errors.push({ message: 'Missing mandatory product struct in params', instancePath: '/params/product' });
        return errors;
    }

    const product = deviceDesc.params.product;

    if (product.type !== 'STRUCT') {
        errors.push({ message: `Product parameter must be STRUCT type, not ${product.type}`, instancePath: '/params/product/type' });
    }

    if (!product.read_only) {
        errors.push({ message: 'Product parameter must be read_only', instancePath: '/params/product/read_only' });
    }

    const productParams = product.params || {};
    const productValue = product.value;
    const productScope = product.access_scope;
    const defaultScope = deviceDesc.default_scope;

    for (const key of REQUIRED_PARAMS) {
        const param = productParams[key];
        const basePath = `/params/product/params/${key}`;

        if (!param) {
            errors.push({ message: `Missing mandatory product parameter '${key}'`, instancePath: basePath });
            continue;
        }

        if (param.type !== 'STRING') {
            errors.push({ message: `Product parameter '${key}' must be STRING type, not ${param.type}`, instancePath: `${basePath}/type` });
        }

        if (param.read_only !== undefined && param.read_only !== true) {
            errors.push({ message: `Product parameter '${key}' must be read_only if specified`, instancePath: `${basePath}/read_only` });
        }

        const derivedScope = getDerivedScope(param, productScope, defaultScope);
        if (derivedScope === "INVALID") {
            errors.push({ message: `Product parameter '${key}' has invalid scope (must be '${REQUIRED_SCOPE}')`, instancePath: `${basePath}/access_scope` });
        }

        const field = productValue?.struct_value?.fields?.[key];
        const stringValue = field?.string_value;

        if (stringValue === undefined || stringValue === null) {
            errors.push({ message: `Product parameter '${key}' has no value`, instancePath: `${basePath}/value` });
        } else if (String(stringValue).trim() === '') {
            errors.push({ message: `Product parameter '${key}' has empty string value`, instancePath: `${basePath}/value/string_value` });
        }

        if (param.value !== undefined && param.value !== null) {
            errors.push({ message: `Product parameter '${key}' should not have a 'value' field (use 'value.struct_value.fields.${key}.string_value' instead)`, instancePath: `${basePath}/value` });
        }

        if (param.params !== undefined && param.params !== null) {
            errors.push({ message: `Product parameter '${key}' should not have a 'params' field`, instancePath: `${basePath}/params` });
        }
    }

    return errors;
}

module.exports = { validateRequiredParamsAndScopes };
