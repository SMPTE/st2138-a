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
 * Template expansion.
 *
 * A param with `template_oid` borrows the shape of another param — the template
 * source named by a fully qualified OID. Expansion materializes that shape into
 * the consumer: every field the source defines and the consumer does not is
 * copied in, so a consumer that says only "I am `template_oid X`" ends up
 * carrying X's `constraint`, `params`, and any other defining fields, ready for
 * a runtime that resolves nothing itself. The consumer's own fields always win,
 * and its `type` and `value` are its own.
 *
 * Nothing is removed: the `template_oid` stays on the consumer as provenance of
 * where its shape came from, and the template sources stay in the tree. Two
 * fields are simply never *inherited*, per the lexical-metadata rule:
 * `template_oid` itself (a consumer keeps its own, not the source's) and the
 * source's reserved `st2138_` hints, which describe the source's declaration
 * site — its namespace and definition-only status — not the shape a consumer
 * takes on.
 *
 * A source may itself be a consumer, so a source is fully expanded before it is
 * copied from; a template that points back onto one already being expanded is a
 * cycle, reported and not followed. Expansion reads a `params` map wherever a
 * descriptor carries one — a device at its root, a `param` or `command` its
 * nested params — so the schema kind never has to be named: validation has
 * already proven the tree's shape, and only a param tree carries `params`. A
 * descriptor with no templates to expand passes through by reference, untouched,
 * so the common case adds neither a copy nor a diff.
 */

'use strict';

const { ERROR } = require('./checks/constants');
const { isPlainObject, fillGaps, escapeSegment } = require('./shape');
const { NAMESPACE_KEY, DEFINITION_ONLY_KEY } = require('./hints');

/**
 * @typedef {object} Expansion
 * @property {object} data the model with every `template_oid` consumer filled in
 * @property {import('./types').Diagnostic[]} diagnostics unresolved or cyclic templates
 * @property {boolean} valid false when any diagnostic is error-level
 */

/** Fields never inherited through a template (lexical to the source's site). */
const LEXICAL_HINTS = new Set([NAMESPACE_KEY, DEFINITION_ONLY_KEY]);

/**
 * Expand a resolved descriptor's `template_oid` references into their consumers.
 * A tree with nothing to expand is returned by reference; otherwise a private
 * clone is expanded in place so the caller's input is never mutated.
 * @param {object} model the resolved (import-free) descriptor
 * @returns {Expansion}
 */
function expandTemplates(model) {
    // Only a param tree carries templates; anything else has nothing to expand.
    if (!isPlainObject(model) || !hasTemplates(model)) {
        return { data: model, diagnostics: [], valid: true };
    }
    const working = structuredClone(model);
    const diagnostics = expandInPlace(working);
    const valid = !diagnostics.some((diagnostic) => diagnostic.level === ERROR);
    return { data: working, diagnostics, valid };
}

/**
 * True when a descriptor's param tree carries any `template_oid` to expand.
 * @param {object} model the descriptor
 * @returns {boolean}
 */
function hasTemplates(model) {
    return scanParams(model.params);
}

/**
 * @param {unknown} params a param map (or non-map)
 * @returns {boolean}
 */
function scanParams(params) {
    if (!isPlainObject(params)) return false;
    for (const key of Object.keys(params)) {
        const node = params[key];
        if (!isPlainObject(node)) continue;
        if (typeof node.template_oid === 'string') return true;
        if (scanParams(node.params)) return true;
    }
    return false;
}

/**
 * Resolve a template's fully qualified OID against the tree root, walking
 * `params` segment by segment. Returns the target param, or undefined when any
 * segment is missing or the target is not a mapping.
 * @param {object} root the descriptor root (a device, or an artifact param)
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
 * Fill a consumer with every field its template source defines and it lacks, so
 * a consumer that says only "I am `template_oid X`" ends up carrying X's shape
 * while its own fields still win. Two rules run before the generic gap-fill:
 * `client_hints` is inherited only after its reserved lexical keys are stripped,
 * and only if anything remains; `template_oid` is never inherited (a consumer
 * keeps its own). The rest defers to {@link fillGaps} — the same shallow rule
 * the resolver merges imports with — over a private clone, so each consumer owns
 * its copy of a shared source.
 * @param {object} node the consumer to fill (mutated)
 * @param {object} source the fully expanded template source
 */
function fillFromTemplate(node, source) {
    if (!('client_hints' in node)) {
        const hints = withoutLexicalHints(source.client_hints);
        if (hints) node.client_hints = hints;
    }
    const inheritable = { ...source };
    delete inheritable.template_oid; // a consumer keeps its own, never the source's
    delete inheritable.client_hints; // handled above, with its lexical filtering
    fillGaps(node, structuredClone(inheritable));
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
 * Expand every `template_oid` in a descriptor's param tree in place. The caller
 * has already established, via {@link hasTemplates}, that `root.params` is a
 * mapping.
 * @param {object} root the descriptor (mutated)
 * @returns {import('./types').Diagnostic[]} errors for unresolved or cyclic templates
 */
function expandInPlace(root) {
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

        // template_oid is a string here: it passed schema validation. Expand the
        // source first, then copy its fields into the consumer.
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

    for (const key of Object.keys(root.params)) {
        expand(root.params[key], `/params/${escapeSegment(key)}`);
    }
    return diagnostics;
}

/** A resolution-time template diagnostic (no source line: it spans the model). */
function templateError(pointer, message) {
    return { level: ERROR, message, instancePath: pointer, lines: null };
}

/**
 * Prefix every `template_oid` in a fragment's param tree with a mount FQOID, in
 * place. A shared library writes its internal references relative to its own
 * root; mounting the library under a consumer at `prefix` shifts them all by
 * that path — `point` becomes `import_geo/point` — so they keep resolving from
 * the assembled descriptor's root wherever the library lands. The fragment's own
 * root maps to the mount node itself, so a top-level `template_oid` on it is left
 * alone; only its descendants shift. An empty prefix — a fragment mounted at a
 * file's own root — is a no-op: the outer import that pulls the file in supplies
 * the shift.
 * @param {object} data a resolved fragment (mutated)
 * @param {string} prefix the FQOID of the node the fragment is mounted at
 * @returns {object} `data`
 */
function rebaseTemplates(data, prefix) {
    if (prefix && isPlainObject(data.params)) {
        for (const key of Object.keys(data.params)) {
            rebaseNode(data.params[key], prefix);
        }
    }
    return data;
}

/**
 * Prefix a node's `template_oid` and recurse its params. `prefix` is non-empty:
 * its only caller guards that, so every reference the walk reaches shifts.
 * @param {unknown} node
 * @param {string} prefix
 */
function rebaseNode(node, prefix) {
    if (!isPlainObject(node)) return;
    if (typeof node.template_oid === 'string') {
        node.template_oid = `${prefix}/${node.template_oid}`;
    }
    if (isPlainObject(node.params)) {
        for (const key of Object.keys(node.params)) {
            rebaseNode(node.params[key], prefix);
        }
    }
}

module.exports = { expandTemplates, resolveFqoid, rebaseTemplates };
