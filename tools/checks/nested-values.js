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

const { WARNING } = require('./constants');

/**
 * 
 * @param {object} desc The input object to check
 * @param {object} opts Collection of options
 * @param {string} opts.schemaName The schema name of the input object
 * @param {boolean} opts.disableNestedValueChecks If true, skip checks for nested values
 * @returns {Array<{message: string, instancePath: string, type: string}>} Array of error messages for any nested values found
 */
function checkNestedValues(desc, opts) {
    // base disable checks
    if (opts.disableNestedValueChecks) return [];
    if (opts.schemaName !== 'device') return [];

    // if the device has no params, there's nothing to check
    if (!desc.params) return [];

    // first scan for all template_oids and build a map of them
    const templateOids = new Set();
    for (const param of Object.values(desc.params)) {
        searchTemplate(param, templateOids);
    }

    // then look for any nested values in the params
    const warnings = [];
    for (const [key, param] of Object.entries(desc.params)) {
        checkParam(param, `params/${key}`, templateOids, warnings);
    }

    return warnings;
}

/**
 * Search for template_oid in the given object and add them to the templateOids set.
 * @param {object} obj The object to search
 * @param {Set<string>} templateOids The set to add found template_oids to
 * @returns {void}
 */
function searchTemplate(obj, templateOids) {
    if (obj.template_oid) {
        templateOids.add(obj.template_oid);
    }
    if (obj.params) {
        for (const param of Object.values(obj.params)) {
            searchTemplate(param, templateOids);
        }
    }
}

/**
 * Check the given parameter for nested values and warn if its not a template_oid.
 * @param {object} param The parameter to check
 * @param {string} path The current path in the object
 * @param {Set<string>} templateOids The set of template_oids to check against
 * @param {Array<{message: string, instancePath: string, type: string}>} warnings The array to add warnings to
 * @returns {void}
 */
function checkParam(param, path, templateOids, warnings) {
    // nothing to check if there are no sub-params
    if (!param.params) return;

    for (const [key, subParam] of Object.entries(param.params)) {
        const subPath = `${path}/params/${key}`;

        // recursively check sub-params
        checkParam(subParam, subPath, templateOids, warnings);

        // no value, no problem
        if (subParam.value === undefined || subParam.value === null) {
            continue;
        }

        // if the param has a value, check if something else references it as a template_oid
        // first take the /params/, which are not part of template_oids
        // just searching for 'params/' to remove the starting params/ prefix from the root of the path
        const template_oid = subPath.replaceAll('params/', '');
        if (!templateOids.has(template_oid)) {
            warnings.push({
                message: `Nested value found in parameter '${key}' which is not referenced by any template_oid`,
                instancePath: `${subPath}/value`,
                type: WARNING
            });
        }
    }
}

module.exports = { checkNestedValues };
