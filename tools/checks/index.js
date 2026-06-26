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

const mandatory = require('./mandatory');
const nestedValues = require('./nested-values');
const { WARNING, ERROR } = require('./constants');

/**
 * Returns the list of all checks. Each check has a `name` and a
 * `run(data, opts)` function that returns an array of errors (empty if the
 * check passes or is disabled/not applicable via opts).
 *
 * @returns {Array<{name: string, run: function(object, object): Array}>}
 */
function getChecks() {
    return [
        {
            name: 'mandatory',
            run: mandatory.validateRequiredParamsAndScopes,
        },
        {
            name: 'nestedValues',
            run: nestedValues.checkNestedValues,
        },
    ];
}

/**
 * Runs all applicable checks against the provided data.
 *
 * @param {object} data the parsed descriptor to validate
 * @param {object} opts
 * @param {string} opts.schemaName the schema being validated
 * @param {boolean} opts.disable... multiple flags to disable specific checks
 * @returns {Array<{message: string, instancePath: string}>} aggregated errors from all checks
 */
function runChecks(data, opts) {
    const errors = [];
    const checks = module.exports.getChecks();
    for (const check of checks) {
        const checkErrors = check.run(data, opts);
        errors.push(...checkErrors);
    }
    return errors;
}

module.exports = { getChecks, runChecks, WARNING, ERROR };
