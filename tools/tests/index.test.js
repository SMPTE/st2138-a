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

const { formatDiagnostic, printDiagnostics } = require('../src');
const crypto = require('node:crypto');

describe('formatDiagnostic', () => {
    test('formats a diagnostic with a source line range', () => {
        const line = formatDiagnostic({
            level: 'error',
            message: 'must be string',
            instancePath: '/params/foo',
            lines: { start: 5, end: 7 },
        });
        expect(line).toBe('ERROR: must be string at /params/foo on lines 5-7');
    });

    test('omits line info when lines is null', () => {
        const line = formatDiagnostic({
            level: 'warning',
            message: 'deprecated',
            instancePath: '/params/bar',
            lines: null,
        });
        expect(line).toBe('WARNING: deprecated at /params/bar');
    });
});

describe('printDiagnostics', () => {
    let logSpy;

    beforeEach(() => {
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        logSpy.mockRestore();
    });

    test('logs one formatted line per diagnostic', () => {
        printDiagnostics([
            { level: 'error', message: 'a', instancePath: '/x', lines: null },
            { level: 'warning', message: 'b', instancePath: '/y', lines: { start: 1, end: 2 } },
        ]);
        expect(logSpy).toHaveBeenCalledTimes(2);
        expect(logSpy).toHaveBeenNthCalledWith(1, 'ERROR: a at /x');
        expect(logSpy).toHaveBeenNthCalledWith(2, 'WARNING: b at /y on lines 1-2');
    });

    test('logs nothing for an empty array', () => {
        printDiagnostics([]);
        expect(logSpy).not.toHaveBeenCalled();
    });
});

describe('validate', () => {
    let validate;
    let MockValidator;
    let mockValidate;

    beforeEach(() => {
        jest.resetModules();
        mockValidate = jest.fn().mockResolvedValue({ valid: true, diagnostics: [], data: {} });
        jest.doMock('../src/validator', () => jest.fn(() => ({ validate: mockValidate })));
        MockValidator = require('../src/validator');
        ({ validate } = require('../src'));
    });

    afterEach(() => {
        jest.dontMock('../src/validator');
    });

    test('derives the schema name and applies default check options', async () => {
        await validate('examples/device.example.yaml');
        expect(mockValidate).toHaveBeenCalledWith(
            'device',
            expect.any(URL),
            { digest: null, load: undefined },
            {
                disableMandatoryParams: false,
                disableNestedValueChecks: false,
                disableScopeChecks: false,
            }
        );
    });

    test('honours digest and disable flags', async () => {
        const digest = Buffer.alloc(32, 0xde).toString('base64');
        await validate('examples/param.on_off.yaml', {
            digest,
            disableMandatoryParams: true,
            disableNestedValueChecks: true,
            disableScopeChecks: true,
        });
        expect(mockValidate).toHaveBeenCalledWith(
            'param',
            expect.any(URL),
            { digest, load: undefined },
            {
                disableMandatoryParams: true,
                disableNestedValueChecks: true,
                disableScopeChecks: true,
            }
        );
    });

    test('threads a custom load function through to the engine', async () => {
        const load = jest.fn();
        await validate('examples/device.example.yaml', { load });
        expect(mockValidate).toHaveBeenCalledWith(
            'device',
            expect.any(URL),
            { digest: null, load },
            expect.any(Object)
        );
    });

    test('returns the engine result', async () => {
        const result = await validate('examples/device.example.yaml');
        expect(result).toEqual({ valid: true, diagnostics: [], data: {} });
    });

    test('builds the engine once and reuses it across calls', async () => {
        await validate('examples/device.example.yaml');
        await validate('examples/param.on_off.yaml');
        expect(MockValidator).toHaveBeenCalledTimes(1);
    });
});

describe('resolve', () => {
    let resolve;
    let MockValidator;
    let mockValidateData;
    let mockResolveTree;

    beforeEach(() => {
        jest.resetModules();
        mockValidateData = jest.fn(() => ({ valid: true, diagnostics: [], data: {} }));
        jest.doMock('../src/validator', () => jest.fn(() => ({ validateData: mockValidateData })));
        mockResolveTree = jest.fn().mockResolvedValue({ valid: true, diagnostics: [], data: {}, imports: [] });
        jest.doMock('../src/resolve', () => ({ resolve: mockResolveTree }));
        MockValidator = require('../src/validator');
        ({ resolve } = require('../src'));
    });

    afterEach(() => {
        jest.dontMock('../src/validator');
        jest.dontMock('../src/resolve');
    });

    test('drives the resolver with the digest and a validate closure', async () => {
        await resolve('examples/device.example.yaml');
        expect(mockResolveTree).toHaveBeenCalledWith(
            expect.any(URL),
            { validate: expect.any(Function), load: undefined, digest: null, disableTemplateExpansion: false }
        );
    });

    test('the injected validate applies default check options through validateData', async () => {
        await resolve('examples/device.example.yaml');
        const { validate: injected } = mockResolveTree.mock.calls[0][1];
        const sourceMap = { linesFor: () => null };
        injected('param', { a: 1 }, sourceMap);
        expect(mockValidateData).toHaveBeenCalledWith('param', { a: 1 }, sourceMap, {
            disableMandatoryParams: false,
            disableNestedValueChecks: false,
            disableScopeChecks: false,
        });
    });

    test('honours digest, custom load, and disable flags', async () => {
        const digest = Buffer.alloc(32, 0xde).toString('base64');
        const load = jest.fn();
        await resolve('examples/param.on_off.yaml', {
            digest,
            load,
            disableMandatoryParams: true,
            disableNestedValueChecks: true,
            disableScopeChecks: true,
            disableTemplateExpansion: true,
        });
        expect(mockResolveTree).toHaveBeenCalledWith(
            expect.any(URL),
            { validate: expect.any(Function), load, digest, disableTemplateExpansion: true }
        );
        const { validate: injected } = mockResolveTree.mock.calls[0][1];
        injected('param', {}, { linesFor: () => null });
        expect(mockValidateData).toHaveBeenCalledWith('param', {}, expect.any(Object), {
            disableMandatoryParams: true,
            disableNestedValueChecks: true,
            disableScopeChecks: true,
        });
    });

    test('returns the resolver result unchanged', async () => {
        const out = { valid: false, diagnostics: [{ level: 'error' }], data: {}, imports: [] };
        mockResolveTree.mockResolvedValue(out);
        const result = await resolve('examples/device.example.yaml');
        expect(result).toBe(out);
    });

    test('builds the engine once and reuses it across calls', async () => {
        await resolve('examples/device.example.yaml');
        await resolve('examples/param.on_off.yaml');
        expect(MockValidator).toHaveBeenCalledTimes(1);
    });
});

describe('digest', () => {
    let digest;
    let mockDefaultLoad;

    beforeEach(() => {
        jest.resetModules();
        mockDefaultLoad = jest.fn().mockResolvedValue('hello: world\n');
        jest.doMock('../src/loader', () => ({ defaultLoad: mockDefaultLoad }));
        ({ digest } = require('../src'));
    });

    afterEach(() => {
        jest.dontMock('../src/loader');
    });

    test('hashes the raw bytes from the default loader into a base64 digest', async () => {
        const value = await digest('examples/param.on_off.yaml');
        expect(mockDefaultLoad).toHaveBeenCalledWith(expect.any(URL));
        expect(value).toBe(crypto.createHash('sha256').update('hello: world\n').digest('base64'));
    });

    test('hashes the bytes returned by a custom load function', async () => {
        const load = jest.fn().mockResolvedValue('other: bytes\n');
        const value = await digest('examples/param.on_off.yaml', { load });
        expect(load).toHaveBeenCalledWith(expect.any(URL));
        expect(mockDefaultLoad).not.toHaveBeenCalled();
        expect(value).toBe(crypto.createHash('sha256').update('other: bytes\n').digest('base64'));
    });
});

