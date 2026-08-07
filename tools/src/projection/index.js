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
 * Model projection.
 *
 * Where the resolver turns many files into one import-free tree, projection
 * turns that authored tree into the model a runtime actually serves. It runs an
 * ordered sequence of passes — expand `template_oid` references, then strip the
 * definition-only params they drew from — and returns both views: the runtime
 * device model and the definitions that model was generated from.
 *
 * Projection is defined over a device's parameter tree, so a non-device
 * descriptor passes through unchanged. So does a device with nothing to project
 * — no templates and no definition-only params — which is returned by reference,
 * untouched, so the common case adds neither a copy nor a diff.
 */

'use strict';

const { isPlainObject } = require('../shape');
const { isDefinitionOnly } = require('../hints');
const { expandTemplates } = require('./templates');
const { stripDefinitions } = require('./strip');

/**
 * @typedef {object} Projection
 * @property {object} data the runtime device model (templates expanded, definitions removed)
 * @property {Record<string, import('../types').Definition>} definitions definition subtrees, keyed by FQOID
 * @property {Record<string, string>} references runtime FQOID → the source FQOID it was built from
 * @property {import('../types').Diagnostic[]} diagnostics findings from the passes (e.g. an unresolved template)
 */

/**
 * Project a resolved descriptor into its runtime model and definitions.
 * @param {object} model the resolved (import-free) descriptor
 * @param {string} schemaName the descriptor's schema kind
 * @returns {Projection}
 */
function project(model, schemaName) {
    // Only a device model carries the param tree these passes act on.
    if (schemaName !== 'device' || !isPlainObject(model)) {
        return { data: model, definitions: {}, references: {}, diagnostics: [] };
    }
    // Nothing to expand or strip: hand back the same tree, no copy, no diff.
    if (!hasProjectableNodes(model)) {
        return { data: model, definitions: {}, references: {}, diagnostics: [] };
    }

    const working = structuredClone(model);
    const diagnostics = expandTemplates(working);
    const { data, definitions, references } = stripDefinitions(working);
    return { data, definitions, references, diagnostics };
}

/**
 * True when a device's param tree contains anything projection would change: a
 * `template_oid` to expand or a definition-only param to strip.
 * @param {object} model the device descriptor
 * @returns {boolean}
 */
function hasProjectableNodes(model) {
    return scanParams(model.params);
}

/**
 * @param {unknown} params a param map (or non-map)
 * @returns {boolean}
 */
function scanParams(params) {
    if (!isPlainObject(params)) return false;
    for (const key of Object.keys(params)) {
        const node = params[key];
        if (!isPlainObject(node)) continue;
        if (typeof node.template_oid === 'string' || isDefinitionOnly(node)) return true;
        if (scanParams(node.params)) return true;
    }
    return false;
}

module.exports = { project };
