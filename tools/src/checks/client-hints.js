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

const { ERROR } = require('./constants');
const { isPlainObject, escapeSegment } = require('../shape');
const {
    RESERVED_PREFIX,
    NAMESPACE_KEY,
    DEFINITION_ONLY_KEY,
    DEFINITION_ONLY_VALUE,
    RECOGNIZED_HINTS,
    NAMESPACE_PATTERN,
} = require('../hints');

/**
 * Validate the reserved (`st2138_`-prefixed) client hints on every param. The
 * schema already constrains `client_hints` to a string-to-string map with
 * bounded keys; this check adds the reserved-key semantics on top:
 *
 *   R1. A key under the `st2138_` prefix that is not a recognized reserved key
 *       -> ERROR. The prefix is reserved, so a typo or an unknown directive is a
 *       mistake, not a free-form hint.
 *
 *   R2. `st2138_definition_only` whose value is not the exact string `"true"`
 *       -> ERROR. Absence means false; no other spelling is interpreted.
 *
 *   R3. `st2138_namespace` whose value is not a valid dotted namespace -> ERROR.
 *
 * `client_hints` can sit on any param, on device commands (which are
 * param-shaped), and on the root of a `param`/`command` artifact. The walker
 * visits all of these through its `visit`/`visitCmd` callbacks, including the
 * artifact root itself.
 *
 * @param {object} data the parsed descriptor to check
 * @param {object} opts check options
 * @param {string} opts.schemaName the descriptor's schema kind (device, param, command)
 * @param {boolean} [opts.disableClientHintChecks] if true, skip this check
 * @returns {import('./walker').Visitor|null} a visitor, or null if the check does not apply
 */
function createClientHintsVisitor(data, opts) {
    if (opts.disableClientHintChecks) return null;
    if (!isPlainObject(data)) return null;

    return {
        // device params and param-artifact sub-params (plus the artifact root)
        visit(ctx, errors) {
            checkHints(ctx.param.client_hints, ctx.path, errors);
        },
        // device commands and their nested arguments (plus the command-artifact root)
        visitCmd(ctx, errors) {
            checkHints(ctx.param.client_hints, ctx.path, errors);
        },
    };
}

/**
 * Apply the reserved-key rules to one node's `client_hints` map.
 * @param {unknown} hints the node's client_hints (or absent)
 * @param {string} pointer JSON pointer to the owning param
 * @param {import('./index').RawError[]} errors
 */
function checkHints(hints, pointer, errors) {
    if (!isPlainObject(hints)) return;
    for (const key of Object.keys(hints)) {
        const value = hints[key];
        const at = `${pointer}/client_hints/${escapeSegment(key)}`;

        if (key.startsWith(RESERVED_PREFIX) && !RECOGNIZED_HINTS.has(key)) {
            errors.push({
                message: `Unrecognized reserved client hint '${key}'; '${RESERVED_PREFIX}' hints must be one of: ${[...RECOGNIZED_HINTS].join(', ')}`,
                instancePath: at,
                type: ERROR,
            });
            continue;
        }
        if (key === DEFINITION_ONLY_KEY && value !== DEFINITION_ONLY_VALUE) {
            errors.push({
                message: `Client hint '${DEFINITION_ONLY_KEY}' must be the exact string "${DEFINITION_ONLY_VALUE}"`,
                instancePath: at,
                type: ERROR,
            });
        }
        if (key === NAMESPACE_KEY && !NAMESPACE_PATTERN.test(value)) {
            errors.push({
                message: `Client hint '${NAMESPACE_KEY}' value '${value}' is not a valid namespace; use dot-separated segments (e.g. 'org.smpte.st2138.audio')`,
                instancePath: at,
                type: ERROR,
            });
        }
    }
}

module.exports = { createClientHintsVisitor };
