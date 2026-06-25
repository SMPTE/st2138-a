const checks = require('./index');
const mandatory = require('./mandatory');

describe('getChecks', () => {
    test('returns all checks', () => {
        const result = checks.getChecks();
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('mandatory');
        expect(result[0].run).toBe(mandatory.validateRequiredParamsAndScopes);
    });
});

describe('runChecks', () => {
    let getChecksSpy;

    beforeEach(() => {
        getChecksSpy = jest.spyOn(checks, 'getChecks').mockImplementation(() => {
            throw new Error('getChecks should not be called directly in this test');
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('returns empty array when all checks pass', () => {
        getChecksSpy.mockReturnValue([
            { name: 'check1', run: () => [] },
            { name: 'check2', run: () => [] },
        ]);

        const result = checks.runChecks({}, { schemaName: 'device' });
        expect(result).toEqual([]);
    });

    test('returns errors from the first failing check and stops', () => {
        const check2Run = jest.fn(() => []);
        const mockErrors = [{ message: 'check1 failed', instancePath: '/bad' }];

        getChecksSpy.mockReturnValue([
            { name: 'check1', run: () => mockErrors },
            { name: 'check2', run: check2Run },
        ]);

        const result = checks.runChecks({}, { schemaName: 'device' });
        expect(result).toEqual(mockErrors);
        expect(check2Run).not.toHaveBeenCalled();
    });

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

    test('calls getChecks with no arguments', () => {
        getChecksSpy.mockReturnValue([]);

        checks.runChecks({}, { schemaName: 'param' });
        expect(getChecksSpy).toHaveBeenCalledWith();
    });
});
