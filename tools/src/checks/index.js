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

const mandatory = require('./mandatory');
const nestedValues = require('./nested-values');
const scopes = require('./scopes');
const { walkParams } = require('./walker');
const { WARNING, ERROR } = require('./constants');

/**
 * @typedef {import('../types').CheckOptions} CheckOptions
 * @typedef {import('../types').Level} Level
 * @typedef {import('./walker').Visitor} Visitor
 */

/**
 * A raw validation error, before it is resolved into a Diagnostic. Both AJV
 * errors and check findings share this shape, so it is producer-neutral. When
 * `type` is omitted the error is treated as an error-level finding.
 *
 * @typedef {object} RawError
 * @property {string} message human-readable description
 * @property {string} instancePath JSON pointer to the offending node
 * @property {Level} [type] severity; defaults to error when omitted
 */

/**
 * Returns the list of all checks. A check is one of two shapes:
 *
 * - a standalone check `{ name, run(data, opts) }` that returns an array of
 *   errors (empty if the check passes or is disabled/not applicable via opts);
 * - a walk check `{ name, createVisitor(data, opts) }` that returns a walker
 *   visitor (or null to opt out). Walk checks share a single traversal of the
 *   parameter hierarchy, appending their findings to a shared list.
 *
 * @returns {Array<{name: string, run?: function(object, object): RawError[], createVisitor?: function(object, object): (Visitor|null)}>}
 */
function getChecks() {
    return [
        {
            name: 'mandatory',
            run: mandatory.validateRequiredParamsAndScopes,
        },
        {
            name: 'nestedValues',
            createVisitor: nestedValues.createNestedValuesVisitor,
        },
        {
            name: 'scopes',
            createVisitor: scopes.createScopesVisitor,
        },
    ];
}

/**
 * Runs all applicable checks against the provided data. Standalone checks are
 * run directly; walk checks contribute a visitor to a single shared traversal
 * of the parameter tree so it is only walked once regardless of how many walk
 * checks are registered.
 *
 * @param {object} data the parsed descriptor to validate
 * @param {CheckOptions} opts the options for the checks
 * @returns {RawError[]} aggregated errors from all checks
 */
function runChecks(data, opts) {
    const errors = [];
    const visitors = [];

    const checks = module.exports.getChecks();
    for (const check of checks) {
        if (typeof check.run === 'function') {
            errors.push(...check.run(data, opts));
        } else if (typeof check.createVisitor === 'function') {
            const visitor = check.createVisitor(data, opts);
            if (visitor) visitors.push(visitor);
        }
    }

    walkParams(data, visitors, errors);

    return errors;
}

module.exports = { getChecks, runChecks, WARNING, ERROR };
