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

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const yaml = require('yaml');
const schema = require('../data/device.json');

const Validator = require('../validator');
const checks = require('../checks');

describe('Validator', () => {
    let fetchSpy;
    let runChecksSpy;
    const tempDirs = [];

    const createTempDir = async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'st2138-test'));
        tempDirs.push(tempDir);
        return tempDir;
    };

    beforeEach(() => {
        // default fetch mock to prevent unexpected network calls during tests
        fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
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

    test('loadTestData parses YAML file content', async () => {
        // basic success test for a real yaml file.
        const fixturePath = path.resolve(__dirname, '../../examples/device.example.yaml');
        const { data, sourceMap } = await Validator.loadTestData(pathToFileURL(fixturePath));

        expect(data).toBeDefined();
        expect(typeof data).toBe('object');
        expect(sourceMap).toBeDefined();
        expect(sourceMap.pointers).toBeDefined();
    });

    test('loadTestData rejects on unreadable file path', async () => {
        // path that doesn't exist
        const missingFile = pathToFileURL('/tmp/does-not-exist-2138.yaml');

        await expect(Validator.loadTestData(missingFile)).rejects.toThrow('Cannot open file');
    });

    test('loadTestData enforces SHA-256 digest when provided', async () => {
        // path to the good example
        const fixturePath = path.resolve(__dirname, '../../examples/device.example.yaml');
        const fixtureUrl = pathToFileURL(fixturePath);
        const raw = await fs.readFile(fixturePath, 'utf8');
        // compute its digest
        const digest = crypto.createHash('sha256').update(raw).digest('hex');

        // should resolve with correct digest
        await expect(Validator.loadTestData(fixtureUrl, digest)).resolves.toMatchObject({
            data: expect.any(Object)
        });

        // should reject with incorrect digest
        await expect(Validator.loadTestData(fixtureUrl, 'bad-digest')).rejects.toThrow('Digest mismatch');
    });

    describe('loadTestData with inline serialized data', () => {
        // doesn't need to validate for this test, just that it can parse the content
        // and return a sourceMap
        const testData = {
            name: 'test-device',
            version: '1.0',
            settings: {
                enabled: true,
                timeout: 30
            },
            items: ['a', 'b', 'c']
        };

        test('parses YAML serialized from inline object', async () => {
            const tempDir = await createTempDir();
            const yamlPath = path.join(tempDir, 'test.yaml');
            const yamlContent = yaml.stringify(testData);

            await fs.writeFile(yamlPath, yamlContent, 'utf8');

            // load the testData as yaml
            const { data } = await Validator.loadTestData(pathToFileURL(yamlPath));
            expect(data).toEqual(testData);
        });

        test('parses JSON serialized from inline object', async () => {
            const tempDir = await createTempDir();
            const jsonPath = path.join(tempDir, 'test.json');
            const jsonContent = JSON.stringify(testData, null, 2);

            await fs.writeFile(jsonPath, jsonContent, 'utf8');

            // load the testData as json
            const { data } = await Validator.loadTestData(pathToFileURL(jsonPath));
            expect(data).toEqual(testData);
        });

        test('returns sourceMap for both YAML and JSON', async () => {
            const tempDir = await createTempDir();
            const yamlPath = path.join(tempDir, 'test.yaml');
            await fs.writeFile(yamlPath, yaml.stringify(testData), 'utf8');

            const jsonPath = path.join(tempDir, 'test.json');
            await fs.writeFile(jsonPath, JSON.stringify(testData, null, 2), 'utf8');

            // check sourcemaps for both
            const yamlResult = await Validator.loadTestData(pathToFileURL(yamlPath));
            const jsonResult = await Validator.loadTestData(pathToFileURL(jsonPath));

            expect(yamlResult.sourceMap).toBeDefined();
            expect(yamlResult.sourceMap.pointers).toBeDefined();
            expect(jsonResult.sourceMap).toBeDefined();
            expect(jsonResult.sourceMap.pointers).toBeDefined();
        });
    });

    test('loadTestData fetches from HTTP URL successfully', async () => {
        const testData = { name: 'http-test', value: 42 };
        const jsonContent = JSON.stringify(testData);

        // override the fetch mock to actually work for this test
        fetchSpy.mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(jsonContent)
        });

        const { data } = await Validator.loadTestData(new URL('http://example.com/test.json'));
        expect(data).toEqual(testData);
        expect(fetchSpy).toHaveBeenCalled();
    });

    test('loadTestData rejects failed HTTP fetch', async () => {
        // override the fetch mock to simulate a failed fetch
        fetchSpy.mockResolvedValueOnce({
            ok: false,
            statusText: 'Not Found'
        });

        await expect(
            Validator.loadTestData(new URL('http://example.com/missing.json'))
        ).rejects.toThrow('Failed to fetch');
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

        const loadSpy = jest.spyOn(Validator, 'loadTestData').mockResolvedValue({
            data: { params: {} },
            sourceMap: { pointers: {} }
        });

        const compileSpy = jest.spyOn(validator.ajv, 'compile').mockImplementation(() => {
            const validateFn = () => true;
            validateFn.errors = null;
            return validateFn;
        });

        const result = await validator.validate('device', pathToFileURL(fixturePath));
        expect(result).toEqual({
            valid: true,
            data: expect.any(Object)
        });
        expect(loadSpy).toHaveBeenCalled();
        expect(compileSpy).toHaveBeenCalled();
        expect(runChecksSpy).toHaveBeenCalledWith(
            { params: {} },
            expect.objectContaining({ schemaName: 'device' })
        );
    });

    test('validate returns valid=false when AJV reports schema errors', async () => {
        const validator = new Validator();
        const mockSourceMap = {
            pointers: {
                '/bad': {
                    value: { line: 1 },
                    valueEnd: { line: 1 }
                }
            }
        };
        const mockErrors = [{ instancePath: '/bad', message: 'must be string' }];

        // mock loadTestData return an empty object with a mocked sourceMap
        jest.spyOn(Validator, 'loadTestData').mockResolvedValueOnce({ data: {}, sourceMap: mockSourceMap });
        // mock showErrors to make sure it's called with our mock errors and sourceMap (and to suppress console output during the test)
        const showSpy = jest.spyOn(Validator, 'showErrors').mockImplementationOnce(() => { });

        // mock AJV compile to return a validate function that always fails with our errors
        jest.spyOn(validator.ajv, 'compile').mockImplementationOnce(() => {
            const validateFn = () => false;
            validateFn.errors = mockErrors;
            return validateFn;
        });

        // make sure we get the expected errors
        const result = await validator.validate('device', new URL('file:///tmp/device.invalid.yaml'));
        expect(result).toEqual({ valid: false });
        expect(showSpy).toHaveBeenCalledWith(mockErrors, mockSourceMap);
        expect(runChecksSpy).not.toHaveBeenCalled();
    });

    test('validate handles non-device schema correctly', async () => {
        const validator = new Validator();
        const paramPath = path.resolve(__dirname, '../../examples/param.audio_meter.yaml');

        // test with a known good example of a non-device schema (param)
        const result = await validator.validate('param', pathToFileURL(paramPath));
        expect(result).toEqual({
            valid: true,
            data: expect.any(Object)
        });
    });

    test('validate returns invalid for non-device schema with validation errors', async () => {
        // just a bit of a duplicate test, but with a non-device schema, to make sure
        // its still handled correctly and shows errors.
        const validator = new Validator();
        const tempDir = await createTempDir();
        const testPath = path.join(tempDir, 'invalid.json');

        await fs.writeFile(testPath, JSON.stringify({ invalid: 'data' }), 'utf8');

        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

        const result = await validator.validate('param', pathToFileURL(testPath));
        expect(result.valid).toBe(false);
        expect(logSpy).toHaveBeenCalled();
    });

    test('validate calls runChecks with data and opts after AJV passes', async () => {
        const validator = new Validator();
        const mockSourceMap = { pointers: {} };

        jest.spyOn(Validator, 'loadTestData').mockResolvedValue({
            data: { params: {} },
            sourceMap: mockSourceMap
        });
        jest.spyOn(validator.ajv, 'compile').mockImplementation(() => {
            const validateFn = () => true;
            validateFn.errors = null;
            return validateFn;
        });

        const result = await validator.validate('device', new URL('file:///tmp/device.valid.yaml'));
        expect(result).toEqual({ valid: true, data: expect.any(Object) });
        expect(runChecksSpy).toHaveBeenCalledWith(
            { params: {} },
            {
                schemaName: 'device',
                disableMandatoryParams: false,
                disableNestedValueChecks: false,
            }
        );
    });

    test('validate passes disable flags through to runChecks', async () => {
        const validator = new Validator({ disableMandatoryParams: true, disableNestedValueChecks: true });
        const mockSourceMap = { pointers: {} };

        jest.spyOn(Validator, 'loadTestData').mockResolvedValue({
            data: { params: {} },
            sourceMap: mockSourceMap
        });
        jest.spyOn(validator.ajv, 'compile').mockImplementation(() => {
            const validateFn = () => true;
            validateFn.errors = null;
            return validateFn;
        });

        const result = await validator.validate('device', new URL('file:///tmp/device.valid.yaml'));
        expect(result).toEqual({ valid: true, data: expect.any(Object) });
        expect(runChecksSpy).toHaveBeenCalledWith(
            { params: {} },
            {
                schemaName: 'device',
                disableMandatoryParams: true,
                disableNestedValueChecks: true,
            }
        );
    });

    test('validate returns valid=true when runChecks returns only warnings', async () => {
        const validator = new Validator();
        const mockSourceMap = { pointers: {} };
        const mockWarnings = [{ type: checks.WARNING, message: 'just a warning', instancePath: '/params/foo/value' }];

        jest.spyOn(Validator, 'loadTestData').mockResolvedValue({
            data: { params: {} },
            sourceMap: mockSourceMap
        });
        jest.spyOn(validator.ajv, 'compile').mockImplementation(() => {
            const validateFn = () => true;
            validateFn.errors = null;
            return validateFn;
        });
        runChecksSpy.mockReturnValue(mockWarnings);
        const showSpy = jest.spyOn(Validator, 'showErrors').mockImplementation(() => { });

        const result = await validator.validate('device', new URL('file:///tmp/device.valid.yaml'));
        expect(result).toEqual({ valid: true, data: expect.any(Object) });
        expect(showSpy).toHaveBeenCalledWith(mockWarnings, mockSourceMap);
    });

    test('validate returns valid=false when runChecks returns errors', async () => {
        const validator = new Validator();
        const mockSourceMap = { pointers: {} };
        const mockErrors = [{ message: 'check failed', instancePath: '/params/product' }];

        jest.spyOn(Validator, 'loadTestData').mockResolvedValue({
            data: { params: {} },
            sourceMap: mockSourceMap
        });
        jest.spyOn(validator.ajv, 'compile').mockImplementation(() => {
            const validateFn = () => true;
            validateFn.errors = null;
            return validateFn;
        });
        runChecksSpy.mockReturnValue(mockErrors);
        const showSpy = jest.spyOn(Validator, 'showErrors').mockImplementation(() => { });

        const result = await validator.validate('device', new URL('file:///tmp/device.valid.yaml'));
        expect(result).toEqual({ valid: false });
        expect(showSpy).toHaveBeenCalledWith(mockErrors, mockSourceMap);
    });

    test('showErrors handles errors without sourceMap pointers', () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
        const sourceMap = { pointers: {} };
        const errors = [
            { instancePath: '/missing', message: 'field required' }
        ];

        // if the '/missing' path doesn't exist in sourceMap pointers,
        // it should do its best to still log a useful message
        Validator.showErrors(errors, sourceMap);
        expect(logSpy).toHaveBeenCalledWith('ERROR: field required at /missing');
    });

    test('showErrors includes line info when sourceMap pointers exist', () => {
        // normal function of showErrors is to log the error message along with the
        // instancePath and line numbers if available from the sourceMap.
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
        const sourceMap = {
            pointers: {
                '/field': {
                    value: { line: 5 },
                    valueEnd: { line: 7 }
                }
            }
        };
        const errors = [
            { instancePath: '/field', message: 'type mismatch' }
        ];

        Validator.showErrors(errors, sourceMap);
        expect(logSpy).toHaveBeenCalledWith('ERROR: type mismatch at /field on lines 5-7');
    });

    test('showErrors handles warnings in addition to errors', () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
        const sourceMap = {
            pointers: {
                '/warnField': {
                    value: { line: 10 },
                    valueEnd: { line: 12 }
                }
            }
        };
        const warnings = [
            { type: checks.WARNING, instancePath: '/warnField', message: 'deprecated field' }
        ];
        Validator.showErrors(warnings, sourceMap);
        expect(logSpy).toHaveBeenCalledWith('WARNING: deprecated field at /warnField on lines 10-12');
    });

    test('addSchemas rethrows addSchema errors with pointer and line info', () => {
        const testGenus = '__test_genus_for_addSchemas_throw';
        const testSpecies = 'broken_species';

        // mutate the schema used in validator to add a test genus/species to test against
        schema[testGenus] = {
            [testSpecies]: {
                type: 'string'
            }
        };

        // mock the AJV method to throw an error
        const addSchema = jest.fn(() => {
            throw new Error('AJV schema error');
        });

        try {
            // fancy js magic, you can call a object's methods with a custom "this" context
            expect(() => Validator.prototype.addSchemas.call({ ajv: { addSchema } }, testGenus)).toThrow(
                new RegExp(`AJV schema error at #/${testGenus}/${testSpecies} on lines \\d+-\\d+`)
            );
            expect(addSchema).toHaveBeenCalledTimes(1);
        } finally {
            // clean up the test genus
            delete schema[testGenus];
        }
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
