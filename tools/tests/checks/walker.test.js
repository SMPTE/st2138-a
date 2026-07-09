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

const { walkParams } = require('../../checks/walker');

describe('walkParams', () => {

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
        walkParams(DEVICE, [collectVisitor(log)], []);
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
        walkParams(DEVICE, [{
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
        walkParams({ params: { x: {} } }, [first, second], warnings);
        expect(warnings).toEqual(['1:x', '2:x']);
    });

    // calls finalize once per visitor after the walk completes
    test('calls finalize after the walk completes', () => {
        const order = [];
        const visitor = {
            visit: (ctx) => order.push(`visit:${ctx.key}`),
            finalize: () => order.push('finalize'),
        };
        walkParams({ params: { x: {}, y: {} } }, [visitor], []);
        expect(order).toEqual(['visit:x', 'visit:y', 'finalize']);
    });

    // is a no-op when there is nothing to walk
    test('does nothing when there is no descriptor, no params, or no visitors', () => {
        const visitor = { visit: jest.fn(), finalize: jest.fn() };

        walkParams(null, [visitor], []);
        walkParams({}, [visitor], []);
        walkParams({ params: { x: {} } }, [], []);

        expect(visitor.visit).not.toHaveBeenCalled();
        expect(visitor.finalize).not.toHaveBeenCalled();
    });
});
