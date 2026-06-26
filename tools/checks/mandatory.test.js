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

const { validateRequiredParamsAndScopes } = require('./mandatory.js');

describe("Mandatory", () => {

    describe("skips", () => {
        // test that the check is skipped when disableMandatoryParams is true

        for (const tt of [
            {
                name: "disableMandatoryParams true",
                opts: { schemaName: 'device', disableMandatoryParams: true },
            },
            {
                name: "schemaName is not device",
                opts: { schemaName: 'param', disableMandatoryParams: false },
            },
            {
                name: "schemaName is device_param",
                opts: { schemaName: 'device_param', disableMandatoryParams: false },
            },
        ]) {
            test(`skips when ${tt.name}`, () => {
                // use an empty object to ensure that if the check runs, it will fail
                const errors = validateRequiredParamsAndScopes({}, tt.opts);
                expect(errors).toEqual([]);
            });
        }
    });

    const DEVICE_OPTS = { schemaName: 'device', disableMandatoryParams: false };

    const REQUIRED_KEYS = [
        'name',
        'vendor',
        'version',
        'catena_sdk',
        'catena_sdk_version',
        'serial_number'
    ];

    // each test will mutate this base device object, so we create a fresh copy for each test
    const MINIMAL_DEVICE = {
        params: {
            product: {
                type: 'STRUCT',
                read_only: true,
                params: {
                    name: { type: 'STRING' },
                    vendor: { type: 'STRING' },
                    version: { type: 'STRING' },
                    catena_sdk: { type: 'STRING' },
                    catena_sdk_version: { type: 'STRING' },
                    serial_number: { type: 'STRING' },
                },
                value: {
                    struct_value: {
                        fields: {
                            name: { string_value: 'Test Device' },
                            vendor: { string_value: 'Test Vendor' },
                            version: { string_value: '1.0' },
                            catena_sdk: { string_value: 'Test SDK' },
                            catena_sdk_version: { string_value: '1.0' },
                            serial_number: { string_value: '1234567890' },
                        }
                    }
                }
            }
        }
    };

    let device;
    beforeEach(() => {
        // reset the device object to a known good state before each test
        device = structuredClone(MINIMAL_DEVICE);
    });

    test('returns no errors for a valid device', () => {
        // just the basic valid case with all required fields and correct types
        const errors = validateRequiredParamsAndScopes(device, DEVICE_OPTS);
        expect(errors).toEqual([]);
    });

    test('returns error when deviceDesc is null', () => {
        // hitting the nul check
        const errors = validateRequiredParamsAndScopes(null, DEVICE_OPTS);
        expect(errors).toEqual([
            { message: 'Missing mandatory product struct in params', instancePath: '/params/product' }
        ]);
    });

    test('returns error when deviceDesc is missing params', () => {
        // hitting the missing params check
        const errors = validateRequiredParamsAndScopes({}, DEVICE_OPTS);
        expect(errors).toEqual([
            { message: 'Missing mandatory product struct in params', instancePath: '/params/product' }
        ]);
    });

    test('returns error when product struct is missing', () => {
        // hitting the missing product check
        const errors = validateRequiredParamsAndScopes({ params: {} }, DEVICE_OPTS);
        expect(errors).toEqual([
            { message: 'Missing mandatory product struct in params', instancePath: '/params/product' }
        ]);
    });

    test('returns error when product is missing params', () => {
        // mutate the device to remove the product.params object entirely
        delete device.params.product.params;
        const errors = validateRequiredParamsAndScopes(device, DEVICE_OPTS);
        expect(errors).toEqual(
            // expect one of the error shapes
            expect.arrayContaining([
                {
                    message: "Missing mandatory product parameter 'name'",
                    instancePath: '/params/product/params/name'
                }
            ])
        );
        // but there will be 6 errors one for each required parameter
        expect(errors.length).toBe(REQUIRED_KEYS.length);
    });

    describe('type validation', () => {
        test('returns error when product type is not STRUCT', () => {
            // mutate the device to have an invalid product type
            device.params.product.type = 'STRING';
            const errors = validateRequiredParamsAndScopes(device, DEVICE_OPTS);
            // single error
            expect(errors).toEqual([
                {
                    message: 'Product parameter must be STRUCT type, not STRING',
                    instancePath: '/params/product/type'
                }
            ]);
        });

        for (const key of REQUIRED_KEYS) {
            test(`returns error when ${key} is not STRING type`, () => {
                // mutate the device to have an invalid type for the specific key
                device.params.product.params[key].type = 'INT32';
                const errors = validateRequiredParamsAndScopes(device, DEVICE_OPTS);
                expect(errors).toEqual([
                    {
                        message: `Product parameter '${key}' must be STRING type, not INT32`,
                        instancePath: `/params/product/params/${key}/type`
                    }
                ]);
            });
        }
    });

    describe('scope validation', () => {
        // check all the levels of scope
        test('returns no errors for a valid default_scope', () => {
            // valid default scope
            device.default_scope = 'st2138:mon';
            const errors = validateRequiredParamsAndScopes(device, DEVICE_OPTS);
            expect(errors).toEqual([]);
        });

        test('returns no errors for valid product-level access_scope', () => {
            // valid product-level access scope
            device.params.product.access_scope = 'st2138:mon';
            const errors = validateRequiredParamsAndScopes(device, DEVICE_OPTS);
            expect(errors).toEqual([]);
        });

        for (const key of REQUIRED_KEYS) {
            test(`returns no errors for valid param-level access_scope for ${key}`, () => {
                // valid param-level access scope
                device.params.product.params[key].access_scope = 'st2138:mon';
                const errors = validateRequiredParamsAndScopes(device, DEVICE_OPTS);
                expect(errors).toEqual([]);
            });
        }

        test('returns scope error when default_scope is invalid', () => {
            // mutate the device to have an invalid default scope
            device.default_scope = 'st2138:op';
            const errors = validateRequiredParamsAndScopes(device, DEVICE_OPTS);
            expect(errors).toEqual(
                expect.arrayContaining([
                    {
                        message: "Product parameter 'name' has invalid scope (must be 'st2138:mon')",
                        instancePath: '/params/product/params/name/access_scope'
                    }
                ])
            );
            expect(errors.length).toBe(REQUIRED_KEYS.length);
        });

        test('returns scope error when product-level access_scope is invalid', () => {
            // mutate the device to have an invalid product-level access scope
            device.params.product.access_scope = 'st2138:op';
            const errors = validateRequiredParamsAndScopes(device, DEVICE_OPTS);
            expect(errors).toEqual(
                expect.arrayContaining([
                    {
                        message: "Product parameter 'name' has invalid scope (must be 'st2138:mon')",
                        instancePath: '/params/product/params/name/access_scope'
                    }
                ])
            );
            expect(errors.length).toBe(REQUIRED_KEYS.length);
        });

        for (const key of REQUIRED_KEYS) {
            test(`returns scope error when param-level access_scope is invalid for ${key}`, () => {
                // mutate the device to have an invalid param-level access scope
                device.params.product.params[key].access_scope = 'st2138:op';
                const errors = validateRequiredParamsAndScopes(device, DEVICE_OPTS);
                expect(errors).toEqual([
                    {
                        message: `Product parameter '${key}' has invalid scope (must be 'st2138:mon')`,
                        instancePath: `/params/product/params/${key}/access_scope`
                    }
                ]);
            });
        }
    });

    describe('read_only validation', () => {
        test('returns error when product is not read_only', () => {
            // mutate the device to have read_only false for the product
            device.params.product.read_only = false;
            const errors = validateRequiredParamsAndScopes(device, DEVICE_OPTS);
            expect(errors).toEqual([
                {
                    message: 'Product parameter must be read_only',
                    instancePath: '/params/product/read_only'
                }
            ]);
        });

        test('returns error when read_only is missing (undefined)', () => {
            // mutate the device to remove the read_only property entirely
            delete device.params.product.read_only;
            const errors = validateRequiredParamsAndScopes(device, DEVICE_OPTS);
            expect(errors).toEqual([
                {
                    message: 'Product parameter must be read_only',
                    instancePath: '/params/product/read_only'
                }
            ]);
        });

        for (const key of REQUIRED_KEYS) {
            test(`returns error when ${key} is explicitly read_only: false`, () => {
                // mutate the device to have read_only false for the specific key
                device.params.product.params[key].read_only = false;
                const errors = validateRequiredParamsAndScopes(device, DEVICE_OPTS);
                expect(errors).toEqual([
                    {
                        message: `Product parameter '${key}' must be read_only if specified`,
                        instancePath: `/params/product/params/${key}/read_only`
                    }
                ]);
            });
        }
    });

    describe('value validation', () => {
        test('returns error when product.value is missing', () => {
            // mutate the device to remove the product.value entirely
            delete device.params.product.value;
            const errors = validateRequiredParamsAndScopes(device, DEVICE_OPTS);
            expect(errors).toEqual(
                expect.arrayContaining([
                    {
                        message: "Product parameter 'name' has no value",
                        instancePath: '/params/product/params/name/value'
                    }
                ])
            );
            expect(errors.length).toBe(REQUIRED_KEYS.length);
        });

        for (const key of REQUIRED_KEYS) {
            test(`returns error when ${key} is missing a value`, () => {
                // mutate the device to remove the value for the specific key
                delete device.params.product.value.struct_value.fields[key];
                const errors = validateRequiredParamsAndScopes(device, DEVICE_OPTS);
                expect(errors).toEqual([
                    {
                        message: `Product parameter '${key}' has no value`,
                        instancePath: `/params/product/params/${key}/value`
                    }
                ]);
            });

            test(`returns error when ${key} has empty string value`, () => {
                // mutate the device to have an empty string value for the specific key
                device.params.product.value.struct_value.fields[key].string_value = '';
                const errors = validateRequiredParamsAndScopes(device, DEVICE_OPTS);
                expect(errors).toEqual([
                    {
                        message: `Product parameter '${key}' has empty string value`,
                        instancePath: `/params/product/params/${key}/value/string_value`
                    }
                ]);
            });

            test(`returns error when ${key} has a 'value' field`, () => {
                // mutate the device to have a 'value' field for the specific key
                device.params.product.params[key].value = { string_value: 'should not be here' };
                const errors = validateRequiredParamsAndScopes(device, DEVICE_OPTS);
                expect(errors).toEqual([
                    {
                        message: `Product parameter '${key}' should not have a 'value' field (use 'value.struct_value.fields.${key}.string_value' instead)`,
                        instancePath: `/params/product/params/${key}/value`
                    }
                ]);
            });

            test(`returns error when ${key} has a 'params' field`, () => {
                // mutate the device to have a 'params' field for the specific key
                device.params.product.params[key].params = { sub: { type: 'STRING' } };
                const errors = validateRequiredParamsAndScopes(device, DEVICE_OPTS);
                expect(errors).toEqual([
                    {
                        message: `Product parameter '${key}' should not have a 'params' field`,
                        instancePath: `/params/product/params/${key}/params`
                    }
                ]);
            });
        }
    });
});
