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

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const yaml = require('yaml');

const { defaultLoad, loadDescriptor } = require('../src/loader');

describe('loader', () => {
    let fetchSpy;
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
    });

    afterEach(async () => {
        await Promise.all(
            tempDirs.splice(0).map((dirPath) => fs.rm(dirPath, { recursive: true, force: true }))
        );
        jest.restoreAllMocks();
    });

    test('loadDescriptor parses YAML file content', async () => {
        // basic success test for a real yaml file.
        const fixturePath = path.resolve(__dirname, '../../examples/device.example.yaml');
        const { data, sourceMap } = await loadDescriptor(pathToFileURL(fixturePath));

        expect(data).toBeDefined();
        expect(typeof data).toBe('object');
        expect(sourceMap).toBeDefined();
        expect(typeof sourceMap.linesFor).toBe('function');
    });

    test('defaultLoad rejects on unreadable file path', async () => {
        // path that doesn't exist
        const missingFile = pathToFileURL('/tmp/does-not-exist-2138.yaml');

        await expect(defaultLoad(missingFile)).rejects.toThrow('Cannot open file');
    });

    test('loadDescriptor enforces SHA-256 digest when provided', async () => {
        // path to the good example
        const fixturePath = path.resolve(__dirname, '../../examples/device.example.yaml');
        const fixtureUrl = pathToFileURL(fixturePath);
        const raw = await fs.readFile(fixturePath, 'utf8');
        // compute its digest
        const digest = crypto.createHash('sha256').update(raw).digest('hex');

        // should resolve with correct digest
        await expect(loadDescriptor(fixtureUrl, { digest })).resolves.toMatchObject({
            data: expect.any(Object)
        });

        // should reject with incorrect digest
        await expect(loadDescriptor(fixtureUrl, { digest: 'bad-digest' })).rejects.toThrow('Digest mismatch');
    });

    describe('loadDescriptor with inline serialized data', () => {
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
            const { data } = await loadDescriptor(pathToFileURL(yamlPath));
            expect(data).toEqual(testData);
        });

        test('parses JSON serialized from inline object', async () => {
            const tempDir = await createTempDir();
            const jsonPath = path.join(tempDir, 'test.json');
            const jsonContent = JSON.stringify(testData, null, 2);

            await fs.writeFile(jsonPath, jsonContent, 'utf8');

            // load the testData as json
            const { data } = await loadDescriptor(pathToFileURL(jsonPath));
            expect(data).toEqual(testData);
        });

        test('returns sourceMap for both YAML and JSON', async () => {
            const tempDir = await createTempDir();
            const yamlPath = path.join(tempDir, 'test.yaml');
            await fs.writeFile(yamlPath, yaml.stringify(testData), 'utf8');

            const jsonPath = path.join(tempDir, 'test.json');
            await fs.writeFile(jsonPath, JSON.stringify(testData, null, 2), 'utf8');

            // check sourcemaps for both
            const yamlResult = await loadDescriptor(pathToFileURL(yamlPath));
            const jsonResult = await loadDescriptor(pathToFileURL(jsonPath));

            // resolve known pointers on demand; the line numbers must reflect
            // each real file, so YAML and JSON differ (JSON's leading `{` and
            // per-item lines push everything down by one or more rows).
            expect(yamlResult.sourceMap.linesFor('/name')).toEqual({ start: 1, end: 1 });
            expect(jsonResult.sourceMap.linesFor('/name')).toEqual({ start: 2, end: 2 });

            // a sequence item, addressed by index, resolves deeper in the file
            expect(yamlResult.sourceMap.linesFor('/items/2')).toEqual({ start: 9, end: 9 });
            expect(jsonResult.sourceMap.linesFor('/items/2')).toEqual({ start: 11, end: 11 });
        });
    });

    test('defaultLoad fetches from HTTP URL successfully', async () => {
        const testData = { name: 'http-test', value: 42 };
        const jsonContent = JSON.stringify(testData);

        // override the fetch mock to actually work for this test
        fetchSpy.mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve(jsonContent)
        });

        const { data } = await loadDescriptor(new URL('http://example.com/test.json'));
        expect(data).toEqual(testData);
        expect(fetchSpy).toHaveBeenCalled();
    });

    test('defaultLoad rejects failed HTTP fetch', async () => {
        // override the fetch mock to simulate a failed fetch
        fetchSpy.mockResolvedValueOnce({
            ok: false,
            statusText: 'Not Found'
        });

        await expect(
            loadDescriptor(new URL('http://example.com/missing.json'))
        ).rejects.toThrow('Failed to fetch');
    });

    describe('custom loader', () => {
        test('uses an injected load function instead of the default transport', async () => {
            const load = jest.fn().mockResolvedValue('name: shimmed');
            const url = new URL('memory://fixtures/device.yaml');

            const { data } = await loadDescriptor(url, { load });

            expect(data).toEqual({ name: 'shimmed' });
            expect(load).toHaveBeenCalledWith(url);
            // default transport must not be consulted when a loader is supplied
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        test('verifies the digest against the injected loader output', async () => {
            const raw = 'name: shimmed';
            const digest = crypto.createHash('sha256').update(raw).digest('hex');
            const url = new URL('memory://fixtures/device.yaml');

            await expect(
                loadDescriptor(url, { load: () => Promise.resolve(raw), digest })
            ).resolves.toMatchObject({ data: { name: 'shimmed' } });

            await expect(
                loadDescriptor(url, { load: () => Promise.resolve(raw), digest: 'bad-digest' })
            ).rejects.toThrow('Digest mismatch');
        });
    });

    describe('JSON strictness', () => {
        test('rejects a .json descriptor that uses YAML-only syntax', async () => {
            // comments are valid YAML but not valid JSON; a .json file must stay
            // portable to strict JSON consumers, so this is refused at load time.
            const url = new URL('file:///path/device.json');
            const load = () => Promise.resolve('{ "a": 1 # nope\n}');

            await expect(loadDescriptor(url, { load })).rejects.toThrow('Invalid JSON');
        });

        test('accepts the same comment-bearing content when it is .yaml', async () => {
            const url = new URL('file:///path/device.yaml');
            const load = () => Promise.resolve('a: 1 # fine in yaml');

            await expect(loadDescriptor(url, { load })).resolves.toMatchObject({
                data: { a: 1 }
            });
        });
    });
});
