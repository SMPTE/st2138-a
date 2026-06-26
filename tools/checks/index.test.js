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

const checks = require('./index');
const mandatory = require('./mandatory');
const nestedValues = require('./nested-values');

describe('getChecks', () => {
    // lock in the expected checks
    test('returns all checks', () => {
        const result = checks.getChecks();
        expect(result).toHaveLength(2);
        expect(result[0].name).toBe('mandatory');
        expect(result[0].run).toBe(mandatory.validateRequiredParamsAndScopes);
        expect(result[1].name).toBe('nestedValues');
        expect(result[1].run).toBe(nestedValues.checkNestedValues);
    });
});

describe('runChecks', () => {
    let getChecksSpy;

    beforeEach(() => {
        getChecksSpy = jest.spyOn(checks, 'getChecks').mockImplementation(() => {
            // force tests to provide their own implementation for isolation
            throw new Error('getChecks should not be called directly in this test');
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // base case for successful checks
    test('returns empty array when all checks pass', () => {
        getChecksSpy.mockReturnValue([
            { name: 'check1', run: () => [] },
            { name: 'check2', run: () => [] },
        ]);

        const result = checks.runChecks({}, { schemaName: 'device' });
        expect(result).toEqual([]);
    });

    // case for failing checks
    test('returns errors from all failing checks', () => {
        const check2Run = jest.fn(() => []);
        const mockErrors = [{ message: 'check1 failed', instancePath: '/bad' }];

        getChecksSpy.mockReturnValue([
            { name: 'check1', run: () => mockErrors },
            { name: 'check2', run: check2Run },
        ]);

        const result = checks.runChecks({}, { schemaName: 'device' });
        expect(result).toEqual(mockErrors);
        expect(check2Run).toHaveBeenCalled();
    });

    // passes data and opts to each check run function correctly
    test('passes data and opts to each check run function', () => {
        const check1Run = jest.fn(() => []);
        const testData = { params: { foo: 'bar' } };
        const opts = { schemaName: 'device' };

        getChecksSpy.mockReturnValue([
            { name: 'check1', run: check1Run },
        ]);

        checks.runChecks(testData, opts);
        expect(check1Run).toHaveBeenCalledWith(testData, opts);
    });

    // enforces that getChecks is called with no arguments
    test('calls getChecks with no arguments', () => {
        getChecksSpy.mockReturnValue([]);

        checks.runChecks({}, { schemaName: 'param' });
        expect(getChecksSpy).toHaveBeenCalledWith();
    });
});
