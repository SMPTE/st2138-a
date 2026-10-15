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

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const schema = require('../src/data/device.json');

const Validator = require('../src/validator');
const checks = require('../src/checks');
const loader = require('../src/loader');
const sourcemap = require('../src/sourcemap');

describe('Validator', () => {
    let runChecksSpy;
    const tempDirs = [];

    const createTempDir = async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'st2138-test'));
        tempDirs.push(tempDir);
        return tempDir;
    };

    beforeEach(() => {
        // guard against unexpected network calls during tests
        jest.spyOn(global, 'fetch').mockImplementation(() => {
            throw new Error('Unexpected fetch call in test');
        });
        // default runChecks mock to prevent check-specific errors during tests
        runChecksSpy = jest.spyOn(checks, 'runChecks')
            .mockImplementation(() => { return []; });
    });

    afterEach(async () => {
        await Promise.all(
            tempDirs.splice(0).map((dirPath) => fs.rm(dirPath, { recursive: true, force: true }))
        );
        jest.restoreAllMocks();
    });

    test('validate rejects unknown schema names', async () => {
        const validator = new Validator();
        const fixturePath = path.resolve(__dirname, '../../examples/device.example.yaml');

        await expect(
            // 'notASchema' is not a valid schema genus
            // so this should reject with an error and exit code 2
            validator.validate('notASchema', pathToFileURL(fixturePath))
        ).rejects.toMatchObject({
            error: 2
        });
    });

    test('validate returns valid=true when schema and checks pass', async () => {
        const validator = new Validator();
        const fixturePath = path.resolve(__dirname, '../../examples/device.example.yaml');

        const loadSpy = jest.spyOn(loader, 'loadDescriptor').mockResolvedValue({
            data: { params: {} },
            sourceMap: { linesFor: () => null }
        });

        // the device root is compiled once in the constructor; stub the cached
        // validator so validateData runs without the real schema.
        validator.deviceValidate = Object.assign(jest.fn(() => true), { errors: null });

        const result = await validator.validate('device', pathToFileURL(fixturePath));
        expect(result).toEqual({
            valid: true,
            data: expect.any(Object),
            diagnostics: []
        });
        expect(loadSpy).toHaveBeenCalled();
        expect(validator.deviceValidate).toHaveBeenCalled();
        expect(runChecksSpy).toHaveBeenCalledWith(
            { params: {} },
            expect.objectContaining({ schemaName: 'device' }),
            'all'
        );
    });

    test('validate returns valid=false when AJV reports schema errors', async () => {
        const validator = new Validator();
        const mockSourceMap = {
            linesFor: (pointer) => (pointer === '/bad' ? { start: 1, end: 1 } : null)
        };
        const mockErrors = [{ instancePath: '/bad', message: 'must be string' }];

        // mock loadDescriptor return an empty object with a mocked sourceMap
        jest.spyOn(loader, 'loadDescriptor').mockResolvedValueOnce({ data: {}, sourceMap: mockSourceMap });

        // the device root is compiled once in the constructor; stub the cached
        // validator to fail with our errors so the diagnostics path is exercised.
        validator.deviceValidate = Object.assign(() => false, { errors: mockErrors });

        // AJV errors should be surfaced as structured diagnostics with line info
        const result = await validator.validate('device', new URL('file:///tmp/device.invalid.yaml'));
        expect(result.valid).toBe(false);
        expect(result.diagnostics).toEqual([
            { level: 'error', message: 'must be string', instancePath: '/bad', lines: { start: 1, end: 1 } }
        ]);
        expect(runChecksSpy).not.toHaveBeenCalled();
    });

    test('validate handles non-device schema correctly', async () => {
        const validator = new Validator();
        const paramPath = path.resolve(__dirname, '../../examples/param.audio_meter.yaml');

        // test with a known good example of a non-device schema (param)
        const result = await validator.validate('param', pathToFileURL(paramPath));
        expect(result).toEqual({
            valid: true,
            data: expect.any(Object),
            diagnostics: []
        });
    });

    test('validate returns invalid for non-device schema with validation errors', async () => {
        // just a bit of a duplicate test, but with a non-device schema, to make sure
        // its still handled correctly and shows errors.
        const validator = new Validator();
        const tempDir = await createTempDir();
        const testPath = path.join(tempDir, 'invalid.json');

        await fs.writeFile(testPath, JSON.stringify({ invalid: 'data' }), 'utf8');

        const result = await validator.validate('param', pathToFileURL(testPath));
        expect(result.valid).toBe(false);
        expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    test('validate calls runChecks with data and opts after AJV passes', async () => {
        const validator = new Validator();
        const mockSourceMap = { linesFor: () => null };

        jest.spyOn(loader, 'loadDescriptor').mockResolvedValue({
            data: { params: {} },
            sourceMap: mockSourceMap
        });
        validator.deviceValidate = Object.assign(() => true, { errors: null });

        const result = await validator.validate('device', new URL('file:///tmp/device.valid.yaml'), null, {
            disableMandatoryParams: false,
            disableNestedValueChecks: false,
            disableScopeChecks: false,
        });
        expect(result).toEqual({ valid: true, data: expect.any(Object), diagnostics: [] });
        expect(runChecksSpy).toHaveBeenCalledWith(
            { params: {} },
            {
                schemaName: 'device',
                disableMandatoryParams: false,
                disableNestedValueChecks: false,
                disableScopeChecks: false,
            },
            'all'
        );
    });

    test('validate passes disable flags through to runChecks', async () => {
        const validator = new Validator();
        const mockSourceMap = { linesFor: () => null };

        jest.spyOn(loader, 'loadDescriptor').mockResolvedValue({
            data: { params: {} },
            sourceMap: mockSourceMap
        });
        validator.deviceValidate = Object.assign(() => true, { errors: null });

        const result = await validator.validate('device', new URL('file:///tmp/device.valid.yaml'), null, {
            disableMandatoryParams: true,
            disableNestedValueChecks: true,
            disableScopeChecks: true,
        });
        expect(result).toEqual({ valid: true, data: expect.any(Object), diagnostics: [] });
        expect(runChecksSpy).toHaveBeenCalledWith(
            { params: {} },
            {
                schemaName: 'device',
                disableMandatoryParams: true,
                disableNestedValueChecks: true,
                disableScopeChecks: true,
            },
            'all'
        );
    });

    test('validate returns valid=true when runChecks returns only warnings', async () => {
        const validator = new Validator();
        const mockSourceMap = { linesFor: () => null };
        const mockWarnings = [{ type: checks.WARNING, message: 'just a warning', instancePath: '/params/foo/value' }];

        jest.spyOn(loader, 'loadDescriptor').mockResolvedValue({
            data: { params: {} },
            sourceMap: mockSourceMap
        });
        validator.deviceValidate = Object.assign(() => true, { errors: null });
        runChecksSpy.mockReturnValue(mockWarnings);

        const result = await validator.validate('device', new URL('file:///tmp/device.valid.yaml'));
        expect(result.valid).toBe(true);
        expect(result.diagnostics).toEqual([
            { level: 'warning', message: 'just a warning', instancePath: '/params/foo/value', lines: null }
        ]);
    });

    test('validate returns valid=false when runChecks returns errors', async () => {
        const validator = new Validator();
        const mockSourceMap = { linesFor: () => null };
        const mockErrors = [{ message: 'check failed', instancePath: '/params/product' }];

        jest.spyOn(loader, 'loadDescriptor').mockResolvedValue({
            data: { params: {} },
            sourceMap: mockSourceMap
        });
        validator.deviceValidate = Object.assign(() => true, { errors: null });
        runChecksSpy.mockReturnValue(mockErrors);

        const result = await validator.validate('device', new URL('file:///tmp/device.valid.yaml'));
        expect(result.valid).toBe(false);
        expect(result.diagnostics).toEqual([
            { level: 'error', message: 'check failed', instancePath: '/params/product', lines: null }
        ]);
    });

    test('toDiagnostics handles errors without source lines', () => {
        const sourceMap = { linesFor: () => null };
        const errors = [
            { instancePath: '/missing', message: 'field required' }
        ];

        // if the '/missing' path resolves to no node, the diagnostic is still
        // produced, just without line info
        expect(Validator.toDiagnostics(errors, sourceMap)).toEqual([
            { level: 'error', message: 'field required', instancePath: '/missing', lines: null }
        ]);
    });

    test('toDiagnostics includes line info when the source map resolves a range', () => {
        const sourceMap = {
            linesFor: (pointer) => (pointer === '/field' ? { start: 5, end: 7 } : null)
        };
        const errors = [
            { instancePath: '/field', message: 'type mismatch' }
        ];

        expect(Validator.toDiagnostics(errors, sourceMap)).toEqual([
            { level: 'error', message: 'type mismatch', instancePath: '/field', lines: { start: 5, end: 7 } }
        ]);
    });

    test('toDiagnostics handles warnings in addition to errors', () => {
        const sourceMap = {
            linesFor: (pointer) => (pointer === '/warnField' ? { start: 10, end: 12 } : null)
        };
        const warnings = [
            { type: checks.WARNING, instancePath: '/warnField', message: 'deprecated field' }
        ];

        expect(Validator.toDiagnostics(warnings, sourceMap)).toEqual([
            { level: 'warning', message: 'deprecated field', instancePath: '/warnField', lines: { start: 10, end: 12 } }
        ]);
    });

    test('loadSchema throws an actionable error when the bundled schema is missing', () => {
        // the schema is generated by build-openapi.sh; a fresh checkout that
        // has not run setup should get a helpful message, not MODULE_NOT_FOUND.
        jest.isolateModules(() => {
            jest.spyOn(require('node:fs'), 'existsSync').mockReturnValue(false);
            expect(() => require('../src/validator')).toThrow(
                /Bundled schema not found at .*device\.json[\s\S]*install-tooling\.sh[\s\S]*build-openapi\.sh/
            );
        });
    });

    test('addSchemas rethrows addSchema errors with source line info', () => {
        // force the very first addSchema call to fail; the catch path resolves
        // the failing definition's real line range from data/device.json.
        const addSchema = jest.fn(() => {
            throw new Error('AJV schema error');
        });

        expect(() => Validator.prototype.addSchemas.call({ ajv: { addSchema } }, '$defs')).toThrow(
            /AJV schema error at #\/\$defs\/.+ on lines \d+-\d+/
        );
        expect(addSchema).toHaveBeenCalledTimes(1);
    });

    test('addSchemas omits line info when the failing definition cannot be located', () => {
        // if the on-disk device.json and the loaded schema drift, linesFor
        // returns null; the thrown error must still carry the real AJV message,
        // just without a line range (never a null dereference).
        jest.spyOn(sourcemap, 'parse').mockReturnValue({
            data: null,
            sourceMap: { linesFor: () => null }
        });
        const addSchema = jest.fn(() => {
            throw new Error('AJV schema error');
        });

        let thrown;
        try {
            Validator.prototype.addSchemas.call({ ajv: { addSchema } }, '$defs');
        } catch (err) {
            thrown = err;
        }

        expect(thrown.message).toMatch(/^AJV schema error at #\/\$defs\/.+/);
        expect(thrown.message).not.toMatch(/on lines/);
    });

    test('addSchemas skips inherited and $comment entries in schema genus', () => {
        // set up a test genus with three types of entries:
        // 1. an inherited enumerable property (via Object.create(inheritedProto))
        // 2. an own property starting with '$comment'
        // 3. a normal own property (control case)
        const testGenus = '__test_genus_for_addSchemas';
        const inheritedName = 'inherited_species_for_test';
        const commentName = '$comment_skip_for_test';
        // major edge case here, but the code guards against inherited properties,
        // so we have to intentionally inject one.
        const inheritedProto = {
            [inheritedName]: {
                type: 'string'
            }
        };
        const testGenusEntries = Object.create(inheritedProto);
        testGenusEntries.valid_species = { type: 'string' };
        testGenusEntries[commentName] = 'test comment that should be skipped';

        // mutate the schema used in validator to add a test genus
        schema[testGenus] = testGenusEntries;

        // mock the AJV method to track which entries get passed to it
        const addSchema = jest.fn();

        try {
            // call addSchemas with our test genus and fake ajv
            Validator.prototype.addSchemas.call({ ajv: { addSchema } }, testGenus);

            // verify that the valid own property was passed through to addSchema
            expect(addSchema).toHaveBeenCalledWith(
                testGenusEntries.valid_species,
                `#/${testGenus}/valid_species`
            );
            // verify that inherited and $comment entries were filtered out by addSchemas
            // and never passed to addSchema
            expect(addSchema).not.toHaveBeenCalledWith(
                inheritedProto[inheritedName],
                `#/${testGenus}/${inheritedName}`
            );
            expect(addSchema).not.toHaveBeenCalledWith(
                testGenusEntries[commentName],
                `#/${testGenus}/${commentName}`
            );
        } finally {
            // clean up the test genus
            delete schema[testGenus];
        }
    });
});
