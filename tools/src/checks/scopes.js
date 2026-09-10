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

/**
 * Create a walker visitor that flags any parameter whose `access_scope` is not
 * one of the access scopes declared at the device level (`access_scopes`).
 *
 * Rules (each produces an ERROR):
 *
 *   R1. Any param (at any depth) whose explicit `access_scope` is NOT one of the
 *       device's declared `access_scopes`
 *       -> "Parameter '<key>' has access_scope '<scope>' which is not declared
 *       in the device's access_scopes". Every scope a param uses must be listed
 *       at the device level.
 *
 *   R2. Any TOP-LEVEL command whose explicit `access_scope` is NOT one of the
 *       device's declared `access_scopes`
 *       -> "Command '<key>' has access_scope '<scope>' which is not declared in
 *       the device's access_scopes". Commands are a top-level map that shares
 *       the param schema, so they also carry an `access_scope` that must be
 *       declared at the device level. This is checked in `finalize`, since the
 *       walker only traverses params, not commands.
 *
 * Non-rules (explicitly NOT flagged):
 *   - Param with NO explicit access_scope: it inherits from its parent or the
 *     device default, so there is nothing to check here.
 *   - Param whose access_scope IS in the declared set: exempt from R1.
 *   - A command's nested "params" (its arguments): although they share the param
 *     schema and may carry an access_scope, that scope has no meaning for an
 *     argument, so it is ignored. Only top-level commands are checked (R2).
 *   - Command whose access_scope IS in the declared set: exempt from R2.
 *
 * @param {object} desc The device descriptor to check
 * @param {object} opts Collection of options
 * @param {string} opts.schemaName The schema name of the input object
 * @param {boolean} opts.disableScopeChecks If true, skip checks for invalid scopes
 * @returns {import('./walker').Visitor|null} a visitor, or null if the check does not apply
 */
function createScopesVisitor(desc, opts = {}) {
    // base disable checks
    if (opts.disableScopeChecks) return null;
    if (opts.schemaName !== 'device') return null;

    // no device, nothing to do
    if (!desc) return null;

    const scopes = new Set();
    for (const scope of desc.access_scopes || []) {
        // rely on schema validation to ensure that the scope is a string
        scopes.add(scope);
    }

    return {
        visit(ctx, warnings) {
            const scope = ctx.param.access_scope;

            // a param without an explicit access_scope inherits from its
            // parent or the device default, so there is nothing to check here
            if (scope === undefined || scope === null) return;

            // R1: explicit access_scope not declared at the device level -> ERROR
            const isDeclared = scopes.has(scope);
            if (!isDeclared) {
                warnings.push({
                    message: `Parameter '${ctx.key}' has access_scope '${scope}' which is not declared in the device's access_scopes`,
                    instancePath: `${ctx.path}/access_scope`,
                    type: ERROR,
                });
            }
        },
        visitCmd(ctx, warnings) {
            // only top-level commands are checked (R2); their nested arguments are param-shaped but ignored
            if (ctx.depth > 0) return;

            const scope = ctx.param.access_scope;

            // a command without an explicit access_scope inherits from the device default, so there is nothing to check here
            if (scope === undefined || scope === null) return;

            // R2: explicit access_scope not declared at the device level -> ERROR
            const isDeclared = scopes.has(scope);
            if (!isDeclared) {
                warnings.push({
                    message: `Command '${ctx.key}' has access_scope '${scope}' which is not declared in the device's access_scopes`,
                    instancePath: `${ctx.path}/access_scope`,
                    type: ERROR,
                });
            }
        },
    };
}

module.exports = { createScopesVisitor };