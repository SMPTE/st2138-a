const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const yaml = require('yaml');

const Validator = require('../validator');

describe('Validator', () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const tempDirs = [];

    const createTempDir = async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'st2138-test'));
        tempDirs.push(tempDir);
        return tempDir;
    };

    beforeAll(() => {
        // default fetch mock to prevent unexpected network calls during tests
        fetchSpy.mockImplementation(() => {
            throw new Error('Unexpected fetch call in test');
        });
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    afterEach(async () => {
        await Promise.all(
            tempDirs.splice(0).map((dirPath) => fs.rm(dirPath, { recursive: true, force: true }))
        );
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

    test('validate returns valid=true for known-good device example', async () => {
        const validator = new Validator();
        const fixturePath = path.resolve(__dirname, '../../examples/device.example.yaml');

        // validator.validate should resolve valid: true with known-good example
        const result = await validator.validate('device', pathToFileURL(fixturePath));
        expect(result).toEqual({
            valid: true,
            data: expect.any(Object)
        });
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
        const showSpy = jest.spyOn(Validator, 'showErrors').mockImplementationOnce(() => {});

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

        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        const result = await validator.validate('param', pathToFileURL(testPath));
        expect(result.valid).toBe(false);
        expect(logSpy).toHaveBeenCalled();
    });

    test('showErrors handles errors without sourceMap pointers', () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const sourceMap = { pointers: {} };
        const errors = [
            { instancePath: '/missing', message: 'field required' }
        ];

        // if the '/missing' path doesn't exist in sourceMap pointers,
        // it should do its best to still log a useful message
        Validator.showErrors(errors, sourceMap);
        expect(logSpy).toHaveBeenCalledWith('field required at /missing');
    });

    test('showErrors includes line info when sourceMap pointers exist', () => {
        // normal function of showErrors is to log the error message along with the
        // instancePath and line numbers if available from the sourceMap.
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
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
        expect(logSpy).toHaveBeenCalledWith('type mismatch at /field on lines 5-7');
    });
});
