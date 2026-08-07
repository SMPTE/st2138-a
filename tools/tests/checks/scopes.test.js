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

const { createScopesVisitor } = require('../../src/checks/scopes');
const { walkDesc } = require('../../src/checks/walker');
const { ERROR } = require('../../src/checks/constants');

// drive the scopes visitor through the walker the same way runChecks does
function checkScopes(desc, opts) {
    const visitor = createScopesVisitor(desc, opts);
    if (!visitor) return [];
    const warnings = [];
    walkDesc(desc, [visitor], warnings, opts.schemaName);
    return warnings;
}

describe('checkScopes', () => {

    // A valid device that declares a set of access scopes and only uses
    // scopes drawn from that set across its parameter hierarchy.
    const VALID_DEVICE = {
        access_scopes: ['st2138:mon', 'st2138:op', 'st2138:cfg'],
        default_scope: 'st2138:mon',
        params: {
            parent: {
                type: 'STRUCT',
                access_scope: 'st2138:op',
                params: {
                    child: {
                        type: 'STRING',
                        access_scope: 'st2138:cfg',
                    },
                    sibling: {
                        type: 'INT32',
                        // no access_scope, inherits from parent
                    },
                },
            },
            deep_parent: {
                type: 'STRUCT',
                params: {
                    mid: {
                        type: 'STRUCT',
                        params: {
                            leaf: {
                                type: 'INT32',
                                access_scope: 'st2138:mon',
                            },
                        },
                    },
                },
            },
        },
        commands: {
            do_thing: {
                type: 'STRUCT',
                access_scope: 'st2138:op',
                params: {
                    // command arguments share the param schema and may carry an
                    // access_scope, but it is ignored for arguments
                    arg: {
                        type: 'STRING',
                        access_scope: 'st2138:bogus',
                    },
                },
            },
            other_thing: {
                type: 'STRUCT',
                // no access_scope, nothing to check
            },
        },
    };

    const ENABLED_OPTS = { schemaName: 'device', disableScopeChecks: false };

    let device;
    beforeEach(() => {
        device = structuredClone(VALID_DEVICE);
    });

    // baseline test, does a well-formed device pass with no errors?
    test('returns no errors for a valid device', () => {
        const result = checkScopes(device, ENABLED_OPTS);
        expect(result).toEqual([]);
    });

    // test for no device, should return empty
    test('returns empty when no device is provided', () => {
        const result = checkScopes(null, ENABLED_OPTS);
        expect(result).toEqual([]);
    });

    // called with no opts: the `opts = {}` default applies, so schemaName is
    // undefined and the check disables itself by returning null
    test('returns null when called with no opts', () => {
        const visitor = createScopesVisitor(device);
        expect(visitor).toBeNull();
    });

    // test that disabling the check works
    test('returns empty when disabled', () => {
        device.params.parent.access_scope = 'st2138:bogus';
        const result = checkScopes(device, { schemaName: 'device', disableScopeChecks: true });
        expect(result).toEqual([]);
        // prove that it would have warned if the check was enabled
        const result2 = checkScopes(device, ENABLED_OPTS);
        expect(result2).toHaveLength(1);
    });

    // test that non-device schemaName disables the check
    test('returns empty for non-device schema', () => {
        device.params.parent.access_scope = 'st2138:bogus';
        const result = checkScopes(device, { schemaName: 'param', disableScopeChecks: false });
        expect(result).toEqual([]);
        // prove that it would have warned if the schemaName was 'device'
        const result2 = checkScopes(device, ENABLED_OPTS);
        expect(result2).toHaveLength(1);
    });

    // no params, nothing to check, should return empty
    test('returns empty when device has no params', () => {
        delete device.params;
        const result = checkScopes(device, ENABLED_OPTS);
        expect(result).toEqual([]);
    });

    // no declared access_scopes: every explicit scope is undeclared
    test('flags every explicit scope when device declares no access_scopes', () => {
        delete device.access_scopes;
        const result = checkScopes(device, ENABLED_OPTS);
        // params parent (op), child (cfg), leaf (mon) plus command do_thing (op)
        // all become undeclared; the command argument's scope is still ignored
        expect(result).toHaveLength(4);
    });

    // flags a top-level param using an undeclared scope
    test('flags a top-level param with an undeclared access_scope', () => {
        device.params.parent.access_scope = 'st2138:adm';
        const result = checkScopes(device, ENABLED_OPTS);
        expect(result).toEqual([
            {
                message: "Parameter 'parent' has access_scope 'st2138:adm' which is not declared in the device's access_scopes",
                instancePath: '/params/parent/access_scope',
                type: ERROR,
            },
        ]);
    });

    // flags a deeply nested param using an undeclared scope
    test('flags a deeply nested param with an undeclared access_scope', () => {
        device.params.deep_parent.params.mid.params.leaf.access_scope = 'st2138:adm';
        const result = checkScopes(device, ENABLED_OPTS);
        expect(result).toEqual([
            {
                message: "Parameter 'leaf' has access_scope 'st2138:adm' which is not declared in the device's access_scopes",
                instancePath: '/params/deep_parent/params/mid/params/leaf/access_scope',
                type: ERROR,
            },
        ]);
    });

    // params without an explicit access_scope are never flagged
    test('does not flag params without an access_scope', () => {
        delete device.params.parent.access_scope;
        delete device.params.parent.params.child.access_scope;
        delete device.params.deep_parent.params.mid.params.leaf.access_scope;
        const result = checkScopes(device, ENABLED_OPTS);
        expect(result).toEqual([]);
    });

    // flags multiple undeclared scopes across the hierarchy
    test('flags multiple undeclared scopes', () => {
        device.params.parent.access_scope = 'st2138:adm';
        device.params.parent.params.child.access_scope = 'st2138:nope';
        const result = checkScopes(device, ENABLED_OPTS);
        expect(result).toHaveLength(2);
        expect(result).toEqual(expect.arrayContaining([
            {
                message: "Parameter 'parent' has access_scope 'st2138:adm' which is not declared in the device's access_scopes",
                instancePath: '/params/parent/access_scope',
                type: ERROR,
            },
            {
                message: "Parameter 'child' has access_scope 'st2138:nope' which is not declared in the device's access_scopes",
                instancePath: '/params/parent/params/child/access_scope',
                type: ERROR,
            },
        ]));
    });

    // R2: flags a top-level command with an undeclared access_scope
    test('flags a top-level command with an undeclared access_scope', () => {
        device.commands.do_thing.access_scope = 'st2138:adm';
        const result = checkScopes(device, ENABLED_OPTS);
        expect(result).toEqual([
            {
                message: "Command 'do_thing' has access_scope 'st2138:adm' which is not declared in the device's access_scopes",
                instancePath: '/commands/do_thing/access_scope',
                type: ERROR,
            },
        ]);
    });

    // R2: command arguments (nested params) are ignored, even with a bogus scope
    test('does not flag command arguments (nested command params)', () => {
        // the fixture's do_thing.arg already has an undeclared scope; ensure it
        // is not flagged while the command's own scope is valid
        const result = checkScopes(device, ENABLED_OPTS);
        expect(result).toEqual([]);
    });

    // commands without an explicit access_scope are never flagged
    test('does not flag commands without an access_scope', () => {
        delete device.commands.do_thing.access_scope;
        const result = checkScopes(device, ENABLED_OPTS);
        expect(result).toEqual([]);
    });

    // R2: flags multiple top-level commands with undeclared scopes
    test('flags multiple commands with undeclared scopes', () => {
        device.commands.do_thing.access_scope = 'st2138:adm';
        device.commands.other_thing.access_scope = 'st2138:nope';
        const result = checkScopes(device, ENABLED_OPTS);
        expect(result).toHaveLength(2);
        expect(result).toEqual(expect.arrayContaining([
            {
                message: "Command 'do_thing' has access_scope 'st2138:adm' which is not declared in the device's access_scopes",
                instancePath: '/commands/do_thing/access_scope',
                type: ERROR,
            },
            {
                message: "Command 'other_thing' has access_scope 'st2138:nope' which is not declared in the device's access_scopes",
                instancePath: '/commands/other_thing/access_scope',
                type: ERROR,
            },
        ]));
    });

    // R2: commands are still checked when the device has no params at all
    test('flags an undeclared command scope even when the device has no params', () => {
        delete device.params;
        device.commands.do_thing.access_scope = 'st2138:adm';
        const result = checkScopes(device, ENABLED_OPTS);
        expect(result).toEqual([
            {
                message: "Command 'do_thing' has access_scope 'st2138:adm' which is not declared in the device's access_scopes",
                instancePath: '/commands/do_thing/access_scope',
                type: ERROR,
            },
        ]);
    });

    test('ignores command arguments with undeclared scopes when the command itself is valid', () => {
        device.commands.do_thing.params.arg.access_scope = 'st2138:bogus';
        const result = checkScopes(device, ENABLED_OPTS);
        expect(result).toEqual([]);
    });

    // devices without any commands are handled gracefully (only params checked)
    test('returns no errors when the device has no commands', () => {
        delete device.commands;
        const result = checkScopes(device, ENABLED_OPTS);
        expect(result).toEqual([]);
    });
});
