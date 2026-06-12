const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const yaml = require('yaml');

const Validator = require('../validator');

describe('Validator', () => {
    test('loadTestData parses YAML file content', async () => {
        const fixturePath = path.resolve(__dirname, '../../examples/device.example.yaml');
        const { data, sourceMap } = await Validator.loadTestData(pathToFileURL(fixturePath));

        expect(data).toBeDefined();
        expect(typeof data).toBe('object');
        expect(sourceMap).toBeDefined();
        expect(sourceMap.pointers).toBeDefined();
    });

    test('loadTestData rejects on unreadable file path', async () => {
        const missingFile = pathToFileURL('/tmp/does-not-exist-2138.yaml');

        await expect(Validator.loadTestData(missingFile)).rejects.toThrow('Cannot open file');
    });

    test('loadTestData enforces SHA-256 digest when provided', async () => {
        const fixturePath = path.resolve(__dirname, '../../examples/device.example.yaml');
        const fixtureUrl = pathToFileURL(fixturePath);
        const raw = await fs.readFile(fixturePath, 'utf8');
        const digest = crypto.createHash('sha256').update(raw).digest('hex');

        await expect(Validator.loadTestData(fixtureUrl, digest)).resolves.toMatchObject({
            data: expect.any(Object)
        });

        await expect(Validator.loadTestData(fixtureUrl, 'bad-digest')).rejects.toThrow('Digest mismatch');
    });

    test('validate rejects unknown schema names', async () => {
        const validator = new Validator();
        const fixturePath = path.resolve(__dirname, '../../examples/device.example.yaml');

        await expect(
            validator.validate('notASchema', pathToFileURL(fixturePath))
        ).rejects.toMatchObject({
            error: 2
        });
    });

    test('validate returns valid=true for known-good device example', async () => {
        const validator = new Validator();
        const fixturePath = path.resolve(__dirname, '../../examples/device.example.yaml');

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

        const loadSpy = jest
            .spyOn(Validator, 'loadTestData')
            .mockResolvedValue({ data: {}, sourceMap: mockSourceMap });
        const showSpy = jest.spyOn(Validator, 'showErrors').mockImplementation(() => {});

        const compileSpy = jest.spyOn(validator.ajv, 'compile').mockImplementation(() => {
            const validateFn = () => false;
            validateFn.errors = mockErrors;
            return validateFn;
        });

        try {
            const result = await validator.validate('device', new URL('file:///tmp/device.invalid.yaml'));
            expect(result).toEqual({ valid: false });
            expect(showSpy).toHaveBeenCalledWith(mockErrors, mockSourceMap);
        } finally {
            compileSpy.mockRestore();
            showSpy.mockRestore();
            loadSpy.mockRestore();
        }
    });

    describe('loadTestData with inline serialized data', () => {
        // doesn't need to validate for this test, just that it can parse the content and return a sourceMap
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
            const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'st2138-test-'));
            const yamlPath = path.join(tempDir, 'test.yaml');
            const yamlContent = yaml.stringify(testData);

            await fs.writeFile(yamlPath, yamlContent, 'utf8');

            try {
                const { data } = await Validator.loadTestData(pathToFileURL(yamlPath));
                expect(data).toEqual(testData);
            } finally {
                await fs.rm(tempDir, { recursive: true, force: true });
            }
        });

        test('parses JSON serialized from inline object', async () => {
            const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'st2138-test-'));
            const jsonPath = path.join(tempDir, 'test.json');
            const jsonContent = JSON.stringify(testData, null, 2);

            await fs.writeFile(jsonPath, jsonContent, 'utf8');

            try {
                const { data } = await Validator.loadTestData(pathToFileURL(jsonPath));
                expect(data).toEqual(testData);
            } finally {
                await fs.rm(tempDir, { recursive: true, force: true });
            }
        });

        test('returns sourceMap for both YAML and JSON', async () => {
            const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'st2138-test-'));

            try {
                const yamlPath = path.join(tempDir, 'test.yaml');
                await fs.writeFile(yamlPath, yaml.stringify(testData), 'utf8');

                const jsonPath = path.join(tempDir, 'test.json');
                await fs.writeFile(jsonPath, JSON.stringify(testData, null, 2), 'utf8');

                const yamlResult = await Validator.loadTestData(pathToFileURL(yamlPath));
                const jsonResult = await Validator.loadTestData(pathToFileURL(jsonPath));

                expect(yamlResult.sourceMap).toBeDefined();
                expect(yamlResult.sourceMap.pointers).toBeDefined();
                expect(jsonResult.sourceMap).toBeDefined();
                expect(jsonResult.sourceMap.pointers).toBeDefined();
            } finally {
                await fs.rm(tempDir, { recursive: true, force: true });
            }
        });
    });

    test('loadTestData fetches from HTTP URL successfully', async () => {
        const testData = { name: 'http-test', value: 42 };
        const jsonContent = JSON.stringify(testData);

        const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(jsonContent)
        });

        try {
            const { data } = await Validator.loadTestData(new URL('http://example.com/test.json'));
            expect(data).toEqual(testData);
            expect(fetchSpy).toHaveBeenCalled();
        } finally {
            fetchSpy.mockRestore();
        }
    });

    test('loadTestData rejects failed HTTP fetch', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
            ok: false,
            statusText: 'Not Found'
        });

        try {
            await expect(
                Validator.loadTestData(new URL('http://example.com/missing.json'))
            ).rejects.toThrow('Failed to fetch');
        } finally {
            fetchSpy.mockRestore();
        }
    });

    test('validate handles non-device schema correctly', async () => {
        const validator = new Validator();
        const paramPath = path.resolve(__dirname, '../../examples/param.audio_meter.yaml');

        const result = await validator.validate('param', pathToFileURL(paramPath));
        expect(result).toEqual({
            valid: true,
            data: expect.any(Object)
        });
    });

    test('validate returns invalid for non-device schema with validation errors', async () => {
        const validator = new Validator();
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'st2138-test-'));
        const testPath = path.join(tempDir, 'invalid.json');

        await fs.writeFile(testPath, JSON.stringify({ invalid: 'data' }), 'utf8');

        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        try {
            const result = await validator.validate('param', pathToFileURL(testPath));
            expect(result.valid).toBe(false);
            expect(logSpy).toHaveBeenCalled();
        } finally {
            logSpy.mockRestore();
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    test('showErrors handles errors without sourceMap pointers', () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const sourceMap = { pointers: {} };
        const errors = [
            { instancePath: '/missing', message: 'field required' }
        ];

        try {
            Validator.showErrors(errors, sourceMap);
            expect(logSpy).toHaveBeenCalledWith('field required at /missing');
        } finally {
            logSpy.mockRestore();
        }
    });

    test('showErrors includes line info when sourceMap pointers exist', () => {
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

        try {
            Validator.showErrors(errors, sourceMap);
            expect(logSpy).toHaveBeenCalledWith('type mismatch at /field on lines 5-7');
        } finally {
            logSpy.mockRestore();
        }
    });
});
