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

const { walkDesc } = require('../../src/checks/walker');

describe('walkDesc', () => {

    const DEVICE = {
        params: {
            a: {
                type: 'STRUCT',
                params: {
                    b: { type: 'STRING' },
                    c: {
                        type: 'STRUCT',
                        params: {
                            d: { type: 'INT32' },
                        },
                    },
                },
            },
            e: { type: 'INT32' },
        },
    };

    // capture the context passed for every visited param
    const collectVisitor = (log) => ({
        visit(ctx) {
            log.push({ key: ctx.key, path: ctx.path, depth: ctx.depth });
        },
    });

    // visits every param exactly once, depth-first pre-order
    test('visits every param once in depth-first pre-order', () => {
        const log = [];
        walkDesc(DEVICE, [collectVisitor(log)], []);
        expect(log).toEqual([
            { key: 'a', path: '/params/a', depth: 0 },
            { key: 'b', path: '/params/a/params/b', depth: 1 },
            { key: 'c', path: '/params/a/params/c', depth: 1 },
            { key: 'd', path: '/params/a/params/c/params/d', depth: 2 },
            { key: 'e', path: '/params/e', depth: 0 },
        ]);
    });

    // provides parent and ancestor chain
    test('provides parent and ancestor context', () => {
        const seen = {};
        walkDesc(DEVICE, [{
            visit(ctx) {
                seen[ctx.key] = {
                    parentKey: ctx.parent ? ctx.parent.type : null,
                    ancestors: ctx.ancestors.map((a) => a.key),
                };
            },
        }], []);
        expect(seen.a).toEqual({ parentKey: null, ancestors: [] });
        expect(seen.d).toEqual({ parentKey: 'STRUCT', ancestors: ['a', 'c'] });
        expect(seen.e).toEqual({ parentKey: null, ancestors: [] });
    });

    // invokes every visitor for each param and shares the warnings list
    test('invokes all visitors and shares the warnings list', () => {
        const warnings = [];
        const first = { visit: (ctx, w) => w.push(`1:${ctx.key}`) };
        const second = { visit: (ctx, w) => w.push(`2:${ctx.key}`) };
        walkDesc({ params: { x: {} } }, [first, second], warnings);
        expect(warnings).toEqual(['1:x', '2:x']);
    });

    // calls finalize once per visitor after the walk completes
    test('calls finalize after the walk completes', () => {
        const order = [];
        const visitor = {
            visit: (ctx) => order.push(`visit:${ctx.key}`),
            finalize: () => order.push('finalize'),
        };
        walkDesc({ params: { x: {}, y: {} } }, [visitor], []);
        expect(order).toEqual(['visit:x', 'visit:y', 'finalize']);
    });

    // is a no-op when there is no descriptor or no visitors
    test('does nothing when there is no descriptor or no visitors', () => {
        const visitor = { visit: jest.fn(), finalize: jest.fn() };

        walkDesc(null, [visitor], []);
        walkDesc(undefined, [visitor], []);
        walkDesc({ params: { x: {} } }, [], []);

        expect(visitor.visit).not.toHaveBeenCalled();
        expect(visitor.finalize).not.toHaveBeenCalled();
    });

    // finalize still runs when the descriptor has no params, so params-less
    // checks (e.g. commands) are not skipped
    test('runs finalize even when the descriptor has no params', () => {
        const visit = jest.fn();
        const finalize = jest.fn((warnings) => warnings.push('finalized'));
        const warnings = [];

        walkDesc({}, [{ visit, finalize }], warnings);

        expect(visit).not.toHaveBeenCalled();
        expect(finalize).toHaveBeenCalledTimes(1);
        expect(warnings).toEqual(['finalized']);
    });

    // an empty params map still triggers finalize without visiting anything
    test('runs finalize for an empty params map', () => {
        const visit = jest.fn();
        const finalize = jest.fn();

        walkDesc({ params: {} }, [{ visit, finalize }], []);

        expect(visit).not.toHaveBeenCalled();
        expect(finalize).toHaveBeenCalledTimes(1);
    });

    // escapes special characters in param keys so path is a valid JSON pointer
    test('escapes special characters in param key segments', () => {
        const log = [];
        walkDesc({ params: { 'a/b': { params: { 'c~d': {} } } } }, [collectVisitor(log)], []);
        expect(log.map((e) => e.path)).toEqual([
            '/params/a~1b',
            '/params/a~1b/params/c~0d',
        ]);
    });

    // walks the commands tree via visitCmd for visitors that opt in
    test('visits commands via visitCmd rooted at /commands', () => {
        const desc = {
            params: { p: {} },
            commands: {
                reboot: {
                    params: { delay: {} },
                },
            },
        };
        const params = [];
        const commands = [];
        walkDesc(desc, [{
            visit: (ctx) => params.push({ path: ctx.path, depth: ctx.depth }),
            visitCmd: (ctx) => commands.push({ path: ctx.path, depth: ctx.depth }),
        }], []);
        expect(params).toEqual([{ path: '/params/p', depth: 0 }]);
        expect(commands).toEqual([
            { path: '/commands/reboot', depth: 0 },
            { path: '/commands/reboot/params/delay', depth: 1 },
        ]);
    });

    // a registered visitCmd is not called when the descriptor has no commands
    test('does not call visitCmd when there are no commands', () => {
        const visit = jest.fn();
        const visitCmd = jest.fn();
        walkDesc({ params: { p: {} } }, [{ visit, visitCmd }], []);
        expect(visit).toHaveBeenCalledTimes(1);
        expect(visitCmd).not.toHaveBeenCalled();
    });

    // visit is optional: a visitCmd-only visitor drives the commands walk and
    // its params walk is skipped
    test('treats visit as optional, walking only commands', () => {
        const desc = {
            params: { gain: {} },
            commands: { reboot: {} },
        };
        const seen = [];
        walkDesc(desc, [{ visitCmd: (ctx) => seen.push(ctx.path) }], []);
        expect(seen).toEqual(['/commands/reboot']);
    });

    // visitCmd is optional: a visit-only visitor walks params and leaves the
    // commands tree untouched
    test('treats visitCmd as optional, walking only params', () => {
        const desc = {
            params: { gain: {} },
            commands: { reboot: {} },
        };
        const seen = [];
        walkDesc(desc, [{ visit: (ctx) => seen.push(ctx.path) }], []);
        expect(seen).toEqual(['/params/gain']);
    });

    // a finalize-only visitor walks nothing but still has finalize called
    test('runs finalize for a visitor with neither visit nor visitCmd', () => {
        const finalize = jest.fn();
        walkDesc({ params: { gain: {} }, commands: { reboot: {} } }, [{ finalize }], []);
        expect(finalize).toHaveBeenCalledTimes(1);
    });

    // a `param` artifact IS a param-shaped root: the root is visited (pointer '')
    // and its sub-params resolve relative to it
    test('visits the root and sub-params of a param artifact', () => {
        const log = [];
        const artifact = {
            type: 'STRUCT',
            params: { child: { type: 'INT32' } },
        };
        walkDesc(artifact, [collectVisitor(log)], [], 'param');
        expect(log).toEqual([
            { key: '', path: '', depth: 0 },
            { key: 'child', path: '/params/child', depth: 1 },
        ]);
    });

    // a `command` artifact root is walked via visitCmd, root included
    test('visits the root and arguments of a command artifact via visitCmd', () => {
        const params = [];
        const commands = [];
        const artifact = {
            access_scope: 'st2138:op',
            params: { mode: {} },
        };
        walkDesc(artifact, [{
            visit: (ctx) => params.push(ctx.path),
            visitCmd: (ctx) => commands.push({ path: ctx.path, depth: ctx.depth }),
        }], [], 'command');
        expect(params).toEqual([]);
        expect(commands).toEqual([
            { path: '', depth: 0 },
            { path: '/params/mode', depth: 1 },
        ]);
    });

    // a command artifact is left untouched by a visitor without visitCmd
    test('does not walk a command artifact without a visitCmd', () => {
        const visit = jest.fn();
        walkDesc({ params: { mode: {} } }, [{ visit }], [], 'command');
        expect(visit).not.toHaveBeenCalled();
    });

    // an unknown schema kind carries nothing param-shaped: only finalize runs
    test('walks nothing for a schema kind that is not device/param/command', () => {
        const visit = jest.fn();
        const visitCmd = jest.fn();
        const finalize = jest.fn();
        walkDesc({ params: { p: {} } }, [{ visit, visitCmd, finalize }], [], 'constraint');
        expect(visit).not.toHaveBeenCalled();
        expect(visitCmd).not.toHaveBeenCalled();
        expect(finalize).toHaveBeenCalledTimes(1);
    });
});
