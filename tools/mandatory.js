'use strict';

const REQUIRED_PARAMS = {
    "name": true,
    "vendor": true,
    "version": true,
    "catena_sdk": false,
    "catena_sdk_version": false,
    "serial_number": true
};

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
 * Attempt to read the string value for a product sub-parameter.
 * Supports two value locations:
 *   1. Per-sub-param: product.params[key].value.string_value
 *   2. Struct blob:   product.value.struct_value.fields[key].string_value
 * @param {object} param the sub-parameter descriptor
 * @param {object|undefined} productValue the product param's top-level value
 * @param {string} key the sub-parameter name
 * @returns {string|undefined}
 */
function getStringValue(param, productValue, key) {
    if (param.value && param.value.string_value !== undefined) {
        return param.value.string_value;
    }

    if (productValue &&
        productValue.struct_value &&
        productValue.struct_value.fields) {
        const field = productValue.struct_value.fields[key];
        if (field && field.string_value !== undefined) {
            return field.string_value;
        }
    }

    return undefined;
}

/**
 * Validates that all mandatory product parameters and scopes are present
 * and have valid values.
 * @param {object} deviceDesc the complete device model object
 * @param {boolean} disableMandatoryEnforcement if true, skip validation
 * @throws {Error} if mandatory parameters are missing or have invalid values
 */
function validateRequiredParamsAndScopes(deviceDesc, disableMandatoryEnforcement = false) {
    if (disableMandatoryEnforcement) {
        return;
    }

    if (!deviceDesc || !deviceDesc.params || !deviceDesc.params.product) {
        throw new Error('Missing mandatory product struct in params');
    }

    if (deviceDesc.params.product.type !== 'STRUCT') {
        throw new Error(`Product parameter must be STRUCT type, not ${deviceDesc.params.product.type}`);
    }

    if (!deviceDesc.params.product.read_only) {
        throw new Error('Product parameter must be read_only');
    }

    const productParams = deviceDesc.params.product.params || {};
    const productValue = deviceDesc.params.product.value;
    const productScope = deviceDesc.params.product.access_scope;
    const defaultScope = deviceDesc.default_scope;

    const missing = [];
    const emptyValues = [];
    const invalidScopes = [];

    for (const [key, checkValue] of Object.entries(REQUIRED_PARAMS)) {
        const param = productParams[key];

        if (!param) {
            missing.push(key);
            continue;
        }

        if (param.type !== 'STRING') {
            missing.push(`${key} (not STRING type)`);
            continue;
        }

        const derivedScope = getDerivedScope(param, productScope, defaultScope);
        if (derivedScope === "INVALID") {
            invalidScopes.push(`${key} (derived scope is invalid, must be '${REQUIRED_SCOPE}')`);
        }

        if (checkValue) {
            const stringValue = getStringValue(param, productValue, key);

            if (stringValue === undefined || stringValue === null) {
                emptyValues.push(`${key} (no value found)`);
            } else if (String(stringValue).trim() === '') {
                emptyValues.push(`${key} (empty string value)`);
            }
        }
    }

    const allIssues = [
        ...missing.map(p => `${p} (missing field)`),
        ...emptyValues,
        ...invalidScopes
    ];

    if (allIssues.length > 0) {
        throw new Error(`Invalid mandatory product parameters: ${allIssues.join(', ')}`);
    }
}

module.exports = { validateRequiredParamsAndScopes };
