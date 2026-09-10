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

const { escapeSegment } = require('../shape');

/**
 * @typedef {object} WalkContext
 * @property {object} param the descriptor at the current OID (param-, command-,
 *   or argument-shaped) being visited
 * @property {string} key the OID segment: the node's key within its enclosing
 *   map; the empty string for an artifact root (a `param`/`command` descriptor
 *   that is itself the top-level node), which has no enclosing map
 * @property {string} path escaped JSON pointer to the node (e.g.
 *   `/params/product/params/name`); segments are JSON-pointer escaped, so it is
 *   safe to use directly as an `instancePath`. The empty string at an artifact
 *   root, so its sub-params resolve to `/params/...`
 * @property {object|null} parent the parent node's descriptor, or null at a top-level OID
 * @property {Array<{key: string, param: object}>} ancestors ancestor nodes from root to parent
 * @property {number} depth 0 for a top-level OID (param/command), incremented for each nesting level
 * @property {object} desc the root descriptor being walked
 */

/**
 * @typedef {object} Visitor
 * @property {function(WalkContext, Array): void} [visit] called once per OID in
 *   the `params` tree. A visitor that omits `visit` does not trigger a traversal
 *   of the `params` tree.
 * @property {function(WalkContext, Array): void} [visitCmd] called once per OID
 *   in the `commands` tree. Commands share the param schema, so they and their
 *   nested arguments are param-shaped; `depth` distinguishes a top-level command
 *   (0) from its nested arguments (>= 1). A visitor that omits `visitCmd` does
 *   not trigger a traversal of the `commands` tree.
 * @property {function(Array): void} [finalize] called once after the walk completes,
 *   for checks whose per-node decisions depend on state gathered across the whole tree
 */

/**
 * Walk a descriptor's OID hierarchy depth-first (pre-order), invoking each
 * visitor once per OID-addressable node with a shared context. This lets
 * multiple checks share a single traversal: each visitor appends its findings to
 * the shared `warnings` list.
 *
 * What gets walked depends on the descriptor's schema kind, so the traversal
 * matches how a node may legally nest rather than assuming a device shape:
 *
 * - `device` — not itself a param. Its top-level `params` map is walked via
 *   `visit` and its separate `commands` map via `visitCmd`, each rooted under
 *   its own pointer (`/params/<key>`, `/commands/<key>`).
 * - `param` — the descriptor IS a param-shaped root. The root node itself is
 *   visited via `visit` (pointer ``), then its `params` are walked as sub-nodes.
 * - `command` — like `param`, but the root and its nested arguments are visited
 *   via `visitCmd`.
 * - anything else — not covered at this time (only `finalize` still runs).
 *
 * Commands are param-shaped but reached only by visitors that declare a
 * `visitCmd` callback; visitors without one leave the commands tree (and a
 * `command` root) untouched.
 *
 * After every OID has been visited, each visitor's optional `finalize` hook is
 * called so checks that need the full tree state (for example, a set of template
 * references gathered along the way) can emit their deferred findings.
 * `finalize` always runs (given a descriptor and at least one visitor), even
 * when the descriptor has no params, so params-less checks are not skipped.
 *
 * @param {object} desc the root descriptor to walk
 * @param {Array<Visitor>} visitors the visitors to invoke at each OID
 * @param {Array<{message: string, instancePath: string, type?: string}>} warnings
 *   the shared list that visitors append their findings to
 * @param {string} [schemaName] the descriptor's schema kind (`device`, `param`,
 *   `command`, ...); selects which children are walked. Defaults to `device`.
 * @returns {void}
 */
function walkDesc(desc, visitors, warnings, schemaName = 'device') {
    if (!desc || visitors.length === 0) return;

    const paramVisitors = visitors.filter((v) => typeof v.visit === 'function');
    const cmdVisitors = visitors.filter((v) => typeof v.visitCmd === 'function');

    if (schemaName === 'device') {
        if (paramVisitors.length > 0) {
            for (const [key, param] of Object.entries(desc.params || {})) {
                walkParam(param, {
                    param,
                    key,
                    path: `/params/${escapeSegment(key)}`,
                    parent: null,
                    ancestors: [],
                    depth: 0,
                    desc,
                }, paramVisitors, warnings, 'visit');
            }
        }

        // Commands share the param schema but sit in their own map; only visitors
        // that opt in via `visitCmd` trigger a traversal of the commands tree.
        if (cmdVisitors.length > 0) {
            for (const [key, command] of Object.entries(desc.commands || {})) {
                walkParam(command, {
                    param: command,
                    key,
                    path: `/commands/${escapeSegment(key)}`,
                    parent: null,
                    ancestors: [],
                    depth: 0,
                    desc,
                }, cmdVisitors, warnings, 'visitCmd');
            }
        }
    } else if (schemaName === 'param' || schemaName === 'command') {
        // An artifact root is itself the param/command node, so it is visited
        // directly (pointer ``) before its `params` are walked as sub-nodes.
        const method = schemaName === 'command' ? 'visitCmd' : 'visit';
        const rootVisitors = method === 'visitCmd' ? cmdVisitors : paramVisitors;
        if (rootVisitors.length > 0) {
            walkParam(desc, {
                param: desc,
                key: '',
                path: '',
                parent: null,
                ancestors: [],
                depth: 0,
                desc,
            }, rootVisitors, warnings, method);
        }
    }
    // any other schema kind carries no param-shaped children: nothing to walk

    for (const visitor of visitors) {
        visitor.finalize?.(warnings);
    }
}

/**
 * Recursively visit a single node and its sub-OIDs, invoking `method` (`visit`
 * for the params tree, `visitCmd` for the commands tree) on each visitor. Child
 * OIDs always live under `params`, whichever tree the walk started from.
 *
 * @param {object} param the node descriptor to visit
 * @param {WalkContext} ctx the context describing where `param` sits in the tree
 * @param {Array<Visitor>} visitors the visitors to invoke
 * @param {Array} warnings the shared findings list
 * @param {'visit'|'visitCmd'} method the visitor callback to invoke
 * @returns {void}
 */
function walkParam(param, ctx, visitors, warnings, method) {
    for (const visitor of visitors) {
        visitor[method](ctx, warnings);
    }

    if (!param.params) return;

    const childAncestors = [...ctx.ancestors, { key: ctx.key, param }];
    for (const [key, child] of Object.entries(param.params)) {
        walkParam(child, {
            param: child,
            key,
            path: `${ctx.path}/params/${escapeSegment(key)}`,
            parent: param,
            ancestors: childAncestors,
            depth: ctx.depth + 1,
            desc: ctx.desc,
        }, visitors, warnings, method);
    }
}

module.exports = { walkDesc };

