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

const { WARNING } = require('./constants');

/**
 * Create a walker visitor that flags nested parameter values not referenced by
 * any template_oid, and top-level parameters that lack a value while not being
 * templates. The visitor gathers every template_oid as it walks the tree and
 * defers the nested-value decision to `finalize`, since a referencing
 * template_oid may appear anywhere in the hierarchy.
 *
 * Rules (each produces a WARNING):
 *
 *   R1. Top-level param (depth 0) with NO value AND NO template_oid
 *       -> "Top-level parameter '<key>' has no value and is not a template".
 *       Top-level params are expected to carry a value. A template
 *       (template_oid present) is exempt from R1; it may or may not also declare
 *       its own value, and either is allowed.
 *
 *   R2. Nested param (depth >= 1) WITH a value that is NOT referenced by any
 *       template_oid anywhere in the tree
 *       -> "Nested value found in parameter '<key>' which is not referenced by
 *       any template_oid". Sub-params should not carry standalone values unless
 *       some param points at them via template_oid.
 *
 * Non-rules (explicitly NOT flagged):
 *   - Top-level param WITH a value (expected, never flagged).
 *   - Top-level param that is a template (has template_oid): exempt from R1,
 *     whether or not it also declares its own value.
 *   - Nested param with NO value (nothing to reference, never flagged).
 *   - Nested param whose path IS referenced by a template_oid: exempt from R2.
 *
 * @param {object} desc The device descriptor to check
 * @param {object} opts Collection of options
 * @param {string} opts.schemaName The schema name of the input object
 * @param {boolean} opts.disableNestedValueChecks If true, skip checks for nested values
 * @returns {import('./walker').Visitor|null} a visitor, or null if the check does not apply
 */
function createNestedValuesVisitor(desc, opts) {
    // base disable checks
    if (opts.disableNestedValueChecks) return null;
    if (opts.schemaName !== 'device') return null;

    // no device or no params, nothing to check
    if (!desc || !desc.params) return null;

    const templateOids = new Set();
    const candidates = [];

    return {
        visit(ctx, warnings) {
            const { param, key, path, depth } = ctx;

            const isTopLevel = depth === 0;
            const isTemplate = Boolean(param.template_oid);
            const hasValue = param.value !== undefined && param.value !== null;

            // every template_oid is recorded up front so R2 can be resolved in
            // finalize, once the full set of references is known
            if (isTemplate) {
                templateOids.add(param.template_oid);
            }

            // R1: top-level param with no value and not a template -> WARNING
            if (isTopLevel) {
                if (!hasValue && !isTemplate) {
                    warnings.push({
                        message: `Top-level parameter '${key}' has no value and is not a template`,
                        // leading slash, this is a json pointer for the source map, not an fqoid
                        instancePath: `${path}/value`,
                        type: WARNING,
                    });
                }
                // top-level params are never subject to R2, so stop here
                return;
            }

            // R2 candidate: a nested param that carries a value. The template_oid
            // that would justify it may not have been seen yet, so defer the
            // decision to finalize. Nested params without a value are never flagged.
            if (hasValue) {
                candidates.push({ key, path });
            }
        },
        finalize(warnings) {
            // R2: for each nested value, flag it unless some template_oid points
            // at its path
            for (const { key, path } of candidates) {
                // convert from source map pointer to template_oid by replacing /params/ with /
                // and removing the leading slash
                const template_oid = path.replaceAll('/params/', '/').substring(1);

                const isReferenced = templateOids.has(template_oid);
                if (!isReferenced) {
                    warnings.push({
                        message: `Nested value found in parameter '${key}' which is not referenced by any template_oid`,
                        instancePath: `${path}/value`,
                        type: WARNING,
                    });
                }
            }
        },
    };
}

module.exports = { createNestedValuesVisitor };
