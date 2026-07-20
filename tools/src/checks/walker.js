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

'use strict';

/**
 * @typedef {object} WalkContext
 * @property {object} param the parameter descriptor currently being visited
 * @property {string} key the parameter's key within its parent's param map
 * @property {string} path JSON pointer to the parameter (e.g. `/params/product/params/name`)
 * @property {object|null} parent the parent parameter descriptor, or null for top-level params
 * @property {Array<{key: string, param: object}>} ancestors ancestor params from root to parent
 * @property {number} depth 0 for top-level params, incremented for each nesting level
 * @property {object} desc the root device descriptor being walked
 */

/**
 * @typedef {object} Visitor
 * @property {function(WalkContext, Array): void} visit called once per parameter
 * @property {function(Array): void} [finalize] called once after the walk completes,
 *   for checks whose per-parameter decisions depend on state gathered across the whole tree
 */

/**
 * Walk every parameter in a device descriptor depth-first (pre-order), invoking
 * each visitor once per parameter with a shared context. This lets multiple
 * checks share a single traversal of the parameter hierarchy: each visitor
 * appends its findings to the shared `warnings` list.
 *
 * After every parameter has been visited, each visitor's optional `finalize`
 * hook is called so checks that need the full tree state (for example, a set of
 * template references gathered along the way) can emit their deferred findings.
 * `finalize` always runs (given a descriptor and at least one visitor), even
 * when the descriptor has no params, so params-less checks are not skipped.
 *
 * @param {object} desc the root device descriptor (with a `params` map)
 * @param {Array<Visitor>} visitors the visitors to invoke for each parameter
 * @param {Array<{message: string, instancePath: string, type?: string}>} warnings
 *   the shared list that visitors append their findings to
 * @returns {void}
 */
function walkParams(desc, visitors, warnings) {
    if (!desc || visitors.length === 0) return;

    for (const [key, param] of Object.entries(desc.params || {})) {
        walkParam(param, {
            param,
            key,
            path: `/params/${key}`,
            parent: null,
            ancestors: [],
            depth: 0,
            desc,
        }, visitors, warnings);
    }

    for (const visitor of visitors) {
        visitor.finalize?.(warnings);
    }
}

/**
 * Recursively visit a single parameter and its sub-parameters.
 * @param {object} param the parameter descriptor to visit
 * @param {WalkContext} ctx the context describing where `param` sits in the tree
 * @param {Array<Visitor>} visitors the visitors to invoke
 * @param {Array} warnings the shared findings list
 * @returns {void}
 */
function walkParam(param, ctx, visitors, warnings) {
    for (const visitor of visitors) {
        visitor.visit(ctx, warnings);
    }

    if (!param.params) return;

    const childAncestors = [...ctx.ancestors, { key: ctx.key, param }];
    for (const [key, child] of Object.entries(param.params)) {
        walkParam(child, {
            param: child,
            key,
            path: `${ctx.path}/params/${key}`,
            parent: param,
            ancestors: childAncestors,
            depth: ctx.depth + 1,
            desc: ctx.desc,
        }, visitors, warnings);
    }
}

module.exports = { walkParams };

