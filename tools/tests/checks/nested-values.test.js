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

const { createNestedValuesVisitor } = require('../../checks/nested-values');
const { walkParams } = require('../../checks/walker');
const { WARNING } = require('../../checks/constants');

// drive the nested-values visitor through the walker the same way runChecks does
function checkNestedValues(desc, opts) {
    const visitor = createNestedValuesVisitor(desc, opts);
    if (!visitor) return [];
    const warnings = [];
    walkParams(desc, [visitor], warnings);
    return warnings;
}

describe('checkNestedValues', () => {

    // A valid device with a struct param containing sub-params (no nested values).
    // A template_oid references parent/child so that when child gets a value it's allowed.
    const VALID_DEVICE = {
        params: {
            // examples of valid nested values
            parent: {
                type: 'STRUCT',
                value: { struct_value: {} },
                params: {
                    child: {
                        type: 'STRING',
                        value: { string_value: 'hello' },
                    },
                    sibling: {
                        type: 'INT32',
                    },
                },
            },
            // will be used for mutations
            deep_parent: {
                type: 'STRUCT',
                value: { struct_value: {} },
                params: {
                    mid: {
                        type: 'STRUCT',
                        params: {
                            leaf: {
                                type: 'INT32',
                            },
                        },
                    },
                },
            },
            referrer_parent: {
                template_oid: 'parent',
            },
            referrer_child: {
                template_oid: 'parent/child',
            },
        },
    };

    const ENABLED_OPTS = { schemaName: 'device', disableNestedValueChecks: false };

    let device;
    beforeEach(() => {
        device = structuredClone(VALID_DEVICE);
    });

    // baseline test, does the device pass with no warnings?
    test('returns no warnings for a valid device', () => {
        const result = checkNestedValues(device, ENABLED_OPTS);
        expect(result).toEqual([]);
    });

    // test for no device, should return empty
    test('returns empty when no device is provided', () => {
        const result = checkNestedValues(null, ENABLED_OPTS);
        expect(result).toEqual([]);
    });

    // test that disabling the check works
    test('returns empty when disabled', () => {
        // add a nested value that would normally warn
        device.params.parent.params.sibling.value = { int32_value: 1 };
        const result = checkNestedValues(device, { schemaName: 'device', disableNestedValueChecks: true });
        expect(result).toEqual([]);
        // prove that it would have warned if the check was enabled
        const result2 = checkNestedValues(device, ENABLED_OPTS);
        expect(result2).toHaveLength(1);
    });

    // test that non-device schemaName disables the check
    test('returns empty for non-device schema', () => {
        device.params.parent.params.sibling.value = { int32_value: 1 };
        const result = checkNestedValues(device, { schemaName: 'param', disableNestedValueChecks: false });
        expect(result).toEqual([]);
        // prove that it would have warned if the schemaName was 'device'
        const result2 = checkNestedValues(device, ENABLED_OPTS);
        expect(result2).toHaveLength(1);
    });

    // no params, nothing to check, should return empty
    test('returns empty when device has no params', () => {
        delete device.params;
        const result = checkNestedValues(device, ENABLED_OPTS);
        expect(result).toEqual([]);
    });

    // check that top-level params without a value are warned unless they are templates
    test('warns when top-level param has no value and is not a template', () => {
        delete device.params.parent.value;
        const result = checkNestedValues(device, ENABLED_OPTS);
        expect(result).toContainEqual({
            message: "Top-level parameter 'parent' has no value and is not a template",
            instancePath: '/params/parent/value',
            type: WARNING,
        });
    });

    // check that it does not flag top-level param values, only nested values
    test('does not flag top-level param values', () => {
        // top-level params are expected to have values
        device.params.parent.value = { struct_value: { fields: { child: { string_value: 'x' } } } };
        const result = checkNestedValues(device, ENABLED_OPTS);
        expect(result).toEqual([]);
    });

    // check that it flags a nested value that is not referenced by any template_oid
    test('flags nested value not referenced by any template_oid', () => {
        // sibling is NOT referenced by any template_oid
        device.params.parent.params.sibling.value = { int32_value: 42 };
        const result = checkNestedValues(device, ENABLED_OPTS);
        expect(result).toEqual([
            {
                message: "Nested value found in parameter 'sibling' which is not referenced by any template_oid",
                instancePath: '/params/parent/params/sibling/value',
                type: WARNING,
            },
        ]);
    });

    // check that it flags a deeply nested value
    test('flags deeply nested value not referenced by any template_oid', () => {
        device.params.deep_parent.params.mid.params.leaf.value = { int32_value: 99 };
        const result = checkNestedValues(device, ENABLED_OPTS);
        expect(result).toEqual([
            {
                message: "Nested value found in parameter 'leaf' which is not referenced by any template_oid",
                instancePath: '/params/deep_parent/params/mid/params/leaf/value',
                type: WARNING,
            },
        ]);
    });

    // deeply nested value is referenced by a template_oid, should not warn
    test('does not flag deeply nested value when referenced by template_oid', () => {
        device.params.deep_parent.params.mid.params.leaf.value = { int32_value: 99 };
        // add a new param with a template_oid reference to the deep leaf
        device.params.referrer_leaf = { template_oid: 'deep_parent/mid/leaf' };
        const result = checkNestedValues(device, ENABLED_OPTS);
        expect(result).toEqual([]);
    });

    // check that it flags multiple unreferenced nested values
    test('flags multiple unreferenced nested values', () => {
        device.params.parent.params.child.value = { string_value: 'ok' };
        device.params.parent.params.sibling.value = { int32_value: 99 };
        // remove the template_oid reference to child
        delete device.params.referrer_child;
        // neither child nor sibling is referenced by template_oid
        const result = checkNestedValues(device, ENABLED_OPTS);
        expect(result).toEqual([
            {
                message: "Nested value found in parameter 'child' which is not referenced by any template_oid",
                instancePath: '/params/parent/params/child/value',
                type: WARNING,
            },
            {
                message: "Nested value found in parameter 'sibling' which is not referenced by any template_oid",
                instancePath: '/params/parent/params/sibling/value',
                type: WARNING,
            },
        ]);
    });
});

