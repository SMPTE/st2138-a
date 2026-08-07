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

/*
 * Template expansion pass.
 *
 * A param with `template_oid` borrows the shape of another param — the template
 * source named by a fully qualified OID. Expansion materializes that shape into
 * the consumer: every field the source defines and the consumer does not is
 * copied in, so the consumer that says only "I am `template_oid X`" ends up with
 * X's `constraint`, `params`, and any other defining fields. The consumer's own
 * fields always win, and its `type` and `value` are its own.
 *
 * Two fields are never copied, per the lexical-metadata rule: `template_oid`
 * itself (the strip pass drops it from the runtime model) and the source's
 * reserved `st2138_` hints, which describe the source's declaration site — its
 * namespace and definition-only status — not the shape a consumer inherits.
 *
 * A source may itself be a consumer, so a source is fully expanded before it is
 * copied from; a template that points back onto one already being expanded is a
 * cycle, reported and not followed. Expansion mutates the tree in place; the
 * caller clones first.
 */

'use strict';

const { ERROR } = require('../checks/constants');
const { isPlainObject, escapeSegment } = require('../shape');
const { NAMESPACE_KEY, DEFINITION_ONLY_KEY } = require('../hints');

/** Fields never inherited through a template (lexical to the source's site). */
const LEXICAL_HINTS = new Set([NAMESPACE_KEY, DEFINITION_ONLY_KEY]);

/**
 * Resolve a template's fully qualified OID against the device root, walking
 * `params` segment by segment. Returns the target param, or undefined when any
 * segment is missing or the target is not a mapping.
 * @param {object} root the device descriptor
 * @param {string} fqoid a `/`-separated param path (no leading slash)
 * @returns {object|undefined}
 */
function resolveFqoid(root, fqoid) {
    let node = root;
    for (const segment of fqoid.split('/')) {
        if (!isPlainObject(node) || !isPlainObject(node.params)) return undefined;
        node = node.params[segment];
        if (node === undefined) return undefined;
    }
    return isPlainObject(node) ? node : undefined;
}

/** The JSON pointer of a template target, derived from its FQOID. */
function fqoidToPointer(fqoid) {
    return `/params/${fqoid.split('/').map(escapeSegment).join('/params/')}`;
}

/**
 * Copy every field the source defines and the consumer lacks into the consumer,
 * skipping `template_oid` and the source's reserved hints. `client_hints` is
 * copied only after its reserved keys are removed, and only if anything remains.
 * @param {object} node the consumer to fill (mutated)
 * @param {object} source the fully expanded template source
 */
function fillFromTemplate(node, source) {
    for (const key of Object.keys(source)) {
        if (key === 'template_oid' || key in node) continue;
        if (key === 'client_hints') {
            const hints = withoutLexicalHints(source.client_hints);
            if (hints) node.client_hints = hints;
            continue;
        }
        node[key] = structuredClone(source[key]);
    }
}

/**
 * A copy of a `client_hints` map with the reserved lexical keys removed, or
 * undefined when nothing (usable) remains.
 * @param {unknown} hints
 * @returns {object|undefined}
 */
function withoutLexicalHints(hints) {
    if (!isPlainObject(hints)) return undefined;
    const out = {};
    for (const key of Object.keys(hints)) {
        if (LEXICAL_HINTS.has(key)) continue;
        out[key] = hints[key];
    }
    return Object.keys(out).length ? structuredClone(out) : undefined;
}

/**
 * Expand every `template_oid` in a device descriptor's param tree in place.
 * @param {object} root the device descriptor (mutated)
 * @returns {import('../types').Diagnostic[]} errors for unresolved or cyclic templates
 */
function expandTemplates(root) {
    const diagnostics = [];
    const expanded = new Set(); // nodes whose templates are fully materialized
    const active = new Set();   // nodes on the current expansion path (cycle guard)

    /**
     * @param {unknown} node
     * @param {string} pointer JSON pointer to `node`
     */
    function expand(node, pointer) {
        if (!isPlainObject(node) || expanded.has(node)) return;
        active.add(node);

        // if template_oid is present, we know its a string because it passed schema validation
        // expand the source first, then copy its fields into the consumer
        if (typeof node.template_oid === 'string') {
            const source = resolveFqoid(root, node.template_oid);
            const at = `${pointer}/template_oid`;
            if (source === undefined) {
                diagnostics.push(templateError(at, `template_oid '${node.template_oid}' does not resolve to a parameter`));
            } else if (active.has(source)) {
                diagnostics.push(templateError(at, `template_oid '${node.template_oid}' forms a cycle`));
            } else {
                // Materialize the source before borrowing from it, so a chain of
                // templates resolves fully rather than one link at a time.
                expand(source, fqoidToPointer(node.template_oid));
                fillFromTemplate(node, source);
            }
        }

        if (isPlainObject(node.params)) {
            for (const key of Object.keys(node.params)) {
                expand(node.params[key], `${pointer}/params/${escapeSegment(key)}`);
            }
        }

        active.delete(node);
        expanded.add(node);
    }

    if (isPlainObject(root.params)) {
        for (const key of Object.keys(root.params)) {
            expand(root.params[key], `/params/${escapeSegment(key)}`);
        }
    }
    return diagnostics;
}

/** A resolution-time template diagnostic (no source line: it spans the model). */
function templateError(pointer, message) {
    return { level: ERROR, message, instancePath: pointer, lines: null };
}

module.exports = { expandTemplates, resolveFqoid };
