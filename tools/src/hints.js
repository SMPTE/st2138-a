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
 * Reserved client-hint vocabulary.
 *
 * `client_hints` is an open string-to-string map, but ST 2138-a reserves a
 * small family of keys under the `st2138_` prefix that steer resolution and
 * code generation rather than clients. This module is the single home for those
 * keys, their legal values, and the predicates that read a param's traits from
 * them, so the lexical check (which validates the keys) and the projection
 * passes (which act on the traits) agree on one definition.
 *
 * A namespace root (`st2138_namespace`) names a canonical, language-neutral
 * generated scope and is implicitly definition-only. An explicit
 * `st2138_definition_only: "true"` marks a subtree as build-time only. Both keep
 * their subtree out of the runtime device model.
 */

'use strict';

const { isPlainObject } = require('./shape');

/** Every reserved key shares this prefix; a client hint outside it is free-form. */
const RESERVED_PREFIX = 'st2138_';

/** Names a canonical generated scope; implicitly definition-only. */
const NAMESPACE_KEY = 'st2138_namespace';

/** Marks a declaration and its subtree as build-time only (never runtime). */
const DEFINITION_ONLY_KEY = 'st2138_definition_only';

/** The only accepted value for {@link DEFINITION_ONLY_KEY}; absence means false. */
const DEFINITION_ONLY_VALUE = 'true';

/** The reserved keys a `st2138_`-prefixed hint is allowed to be. */
const RECOGNIZED_HINTS = new Set([NAMESPACE_KEY, DEFINITION_ONLY_KEY]);

/**
 * A logical namespace: one or more dot-separated segments, each starting with a
 * letter. Dotted (not `::`) so it is language-neutral; a generator maps it to
 * its target's construct (C++ `::`, Go package, Rust module).
 */
const NAMESPACE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/;

/**
 * The `client_hints` map of a node, or undefined when the node is not a mapping
 * or carries none.
 * @param {unknown} node
 * @returns {object|undefined}
 */
function clientHints(node) {
    return isPlainObject(node) ? node.client_hints : undefined;
}

/**
 * The canonical namespace a node declares, or null when it declares none. An
 * empty string is treated as no namespace (the lexical check rejects it).
 * @param {unknown} node
 * @returns {string|null}
 */
function namespaceOf(node) {
    const hints = clientHints(node);
    const value = hints && hints[NAMESPACE_KEY];
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * True when a node declares a namespace, making it a namespace root (and thus
 * implicitly definition-only).
 * @param {unknown} node
 * @returns {boolean}
 */
function isNamespaceRoot(node) {
    return namespaceOf(node) !== null;
}

/**
 * True when a node explicitly declares `st2138_definition_only: "true"`.
 * @param {unknown} node
 * @returns {boolean}
 */
function isExplicitDefinitionOnly(node) {
    const hints = clientHints(node);
    return Boolean(hints && hints[DEFINITION_ONLY_KEY] === DEFINITION_ONLY_VALUE);
}

/**
 * True when a node is definition-only at its own declaration: a namespace root
 * or an explicit definition-only. Scope inheritance is handled by the strip
 * pass, which never descends into a definition-only subtree.
 * @param {unknown} node
 * @returns {boolean}
 */
function isDefinitionOnly(node) {
    return isNamespaceRoot(node) || isExplicitDefinitionOnly(node);
}

module.exports = {
    RESERVED_PREFIX,
    NAMESPACE_KEY,
    DEFINITION_ONLY_KEY,
    DEFINITION_ONLY_VALUE,
    RECOGNIZED_HINTS,
    NAMESPACE_PATTERN,
    namespaceOf,
    isNamespaceRoot,
    isExplicitDefinitionOnly,
    isDefinitionOnly,
};
