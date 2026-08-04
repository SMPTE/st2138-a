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
 * Descriptor shape.
 *
 * The shared vocabulary for walking a descriptor's importable nodes: which
 * child maps a node of a given kind can contain, whether a value is a mapping
 * the walk descends into, and how to name a node by JSON pointer. Both the
 * resolver (which inlines imports) and the pinner (which records their digests)
 * traverse the same structure, so this knowledge lives once, below both.
 */

'use strict';

/**
 * Param-bearing maps to descend, by node kind. `param` and `command` are
 * distinct schemas sharing a YAML anchor (a command adds `response`); both carry
 * only nested `params` (a command's arguments are themselves a `params` map). A
 * `device` additionally carries a top-level `commands` map, which never nests.
 * `import` lives on param/command nodes and is rejected elsewhere by the
 * schema's `additionalProperties: false`, so descending these maps reaches every
 * importable node without a generic object crawl.
 * @type {string[]}
 */
const NESTED_FIELDS = ['params'];
const ROOT_FIELDS = ['params', 'commands'];

/**
 * The maps to descend for a descriptor of the given schema type. Deriving the
 * walk from the declared type — rather than from position in the tree — lets
 * traversal run at any level: a whole `device`, or a single imported `param`
 * or `command` fragment, each walk exactly the maps they can legally contain.
 * @param {string} schemaName
 * @returns {string[]}
 */
function walkableFields(schemaName) {
    return schemaName === 'device' ? ROOT_FIELDS : NESTED_FIELDS;
}

/**
 * True for a mapping the walk descends into: a non-null, non-array object.
 * Scalars and arrays are atomic — the resolver's merge replaces them wholesale
 * and the pinner's walk stops at them.
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Escape a raw key into a JSON pointer segment (RFC 6901): `~`->`~0`, `/`->`~1`. */
function escapeSegment(segment) {
    return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

module.exports = { NESTED_FIELDS, ROOT_FIELDS, walkableFields, isPlainObject, escapeSegment };
