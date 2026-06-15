const { validateRequiredParamsAndScopes } = require('../mandatory.js');

describe("Mandatory", () => {

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
        device = structuredClone(MINIMAL_DEVICE);
    });

    test('returns no errors for a valid device', () => {
        const errors = validateRequiredParamsAndScopes(device);
        expect(errors).toEqual([]);
    });

    test('returns error when deviceDesc is null', () => {
        const errors = validateRequiredParamsAndScopes(null);
        expect(errors).toEqual([
            { message: 'Missing mandatory product struct in params', instancePath: '/params/product' }
        ]);
    });

    test('returns error when deviceDesc is missing params', () => {
        const errors = validateRequiredParamsAndScopes({});
        expect(errors).toEqual([
            { message: 'Missing mandatory product struct in params', instancePath: '/params/product' }
        ]);
    });

    test('returns error when product struct is missing', () => {
        const errors = validateRequiredParamsAndScopes({ params: {} });
        expect(errors).toEqual([
            { message: 'Missing mandatory product struct in params', instancePath: '/params/product' }
        ]);
    });

    test('returns error when product is missing params', () => {
        delete device.params.product.params;
        const errors = validateRequiredParamsAndScopes(device);
        expect(errors).toEqual(
            expect.arrayContaining([
                {
                    message: "Missing mandatory product parameter 'name'",
                    instancePath: '/params/product/params/name'
                }
            ])
        );
        expect(errors.length).toBe(REQUIRED_KEYS.length);
    });

    describe('type validation', () => {
        test('returns error when product type is not STRUCT', () => {
            device.params.product.type = 'STRING';
            const errors = validateRequiredParamsAndScopes(device);
            expect(errors).toEqual([
                {
                    message: 'Product parameter must be STRUCT type, not STRING',
                    instancePath: '/params/product/type'
                }
            ]);
        });

        for (const key of REQUIRED_KEYS) {
            test(`returns error when ${key} is not STRING type`, () => {
                device.params.product.params[key].type = 'INT32';
                const errors = validateRequiredParamsAndScopes(device);
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
        test('returns no errors for a valid default_scope', () => {
            device.default_scope = 'st2138:mon';
            const errors = validateRequiredParamsAndScopes(device);
            expect(errors).toEqual([]);
        });

        test('returns no errors for valid product-level access_scope', () => {
            device.params.product.access_scope = 'st2138:mon';
            const errors = validateRequiredParamsAndScopes(device);
            expect(errors).toEqual([]);
        });

        for (const key of REQUIRED_KEYS) {
            test(`returns no errors for valid param-level access_scope for ${key}`, () => {
                device.params.product.params[key].access_scope = 'st2138:mon';
                const errors = validateRequiredParamsAndScopes(device);
                expect(errors).toEqual([]);
            });
        }

        test('returns scope error when default_scope is invalid', () => {
            device.default_scope = 'st2138:op';
            const errors = validateRequiredParamsAndScopes(device);
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
            device.params.product.access_scope = 'st2138:op';
            const errors = validateRequiredParamsAndScopes(device);
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
                device.params.product.params[key].access_scope = 'st2138:op';
                const errors = validateRequiredParamsAndScopes(device);
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
            device.params.product.read_only = false;
            const errors = validateRequiredParamsAndScopes(device);
            expect(errors).toEqual([
                {
                    message: 'Product parameter must be read_only',
                    instancePath: '/params/product/read_only'
                }
            ]);
        });

        test('returns error when read_only is missing (undefined)', () => {
            delete device.params.product.read_only;
            const errors = validateRequiredParamsAndScopes(device);
            expect(errors).toEqual([
                {
                    message: 'Product parameter must be read_only',
                    instancePath: '/params/product/read_only'
                }
            ]);
        });

        for (const key of REQUIRED_KEYS) {
            test(`returns error when ${key} is explicity read_only: false`, () => {
                device.params.product.params[key].read_only = false;
                const errors = validateRequiredParamsAndScopes(device);
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
            delete device.params.product.value;
            const errors = validateRequiredParamsAndScopes(device);
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
                delete device.params.product.value.struct_value.fields[key];
                const errors = validateRequiredParamsAndScopes(device);
                expect(errors).toEqual([
                    {
                        message: `Product parameter '${key}' has no value`,
                        instancePath: `/params/product/params/${key}/value`
                    }
                ]);
            });

            test(`returns error when ${key} has empty string value`, () => {
                device.params.product.value.struct_value.fields[key].string_value = '   ';
                const errors = validateRequiredParamsAndScopes(device);
                expect(errors).toEqual([
                    {
                        message: `Product parameter '${key}' has empty string value`,
                        instancePath: `/params/product/params/${key}/value/string_value`
                    }
                ]);
            });
        }
    });
});