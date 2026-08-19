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

/**
 * The shared core of the model's merge: copy into `target`, in place, every key
 * `source` defines that `target` lacks. Keys already on `target` are left alone,
 * so `target` wins every collision. Copied values are linked by reference, not
 * cloned — a caller that fans one `source` out to many targets, or that must not
 * alias `source`, clones the source first (`fillGaps(t, structuredClone(s))`).
 * @param {object} target the mapping to fill (mutated, and returned)
 * @param {object} source the mapping to draw absent keys from
 * @returns {object} `target`
 */
function fillGaps(target, source) {
    for (const key of Object.keys(source)) {
        if (!(key in target)) {
            target[key] = source[key];
        }
    }
    return target;
}

/**
 * The model's single merge rule: combine a base mapping with an overriding one,
 * one level deep. Every key `local` defines replaces `base`'s counterpart
 * wholesale, and keys present on only one side survive. When either input is not
 * a mapping the `local` value wins outright — the override stands in for the
 * base rather than blending into it. Neither input is mutated, and values are
 * shared by reference, not cloned, so a caller that fans one `base` out to many
 * locals must clone what it keeps.
 *
 * A specialization that changes a node's `type` therefore replaces its `value`
 * whole rather than deep-merging two variants of a union into an invalid shape,
 * and an importing override combines with its imported base exactly as a
 * template consumer does with its source — {@link fillGaps} is the shared core
 * at both sites, here wrapped pure over a private copy of `local`.
 * @param {unknown} base the underlying value (imported file / template source)
 * @param {unknown} local the overriding value (importing node / consumer)
 * @returns {unknown} the merged mapping, or `local` when either side is atomic
 */
function shallowMerge(base, local) {
    if (!isPlainObject(base) || !isPlainObject(local)) {
        return local;
    }
    return fillGaps({ ...local }, base);
}

/** Escape a raw key into a JSON pointer segment (RFC 6901): `~`->`~0`, `/`->`~1`. */
function escapeSegment(segment) {
    return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Inverse of {@link escapeSegment} (RFC 6901): `~1`->`/`, then `~0`->`~`. */
function unescapeSegment(segment) {
    return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Render a key path as an RFC 6901 JSON pointer. */
function toPointer(path) {
    return path.map((segment) => `/${escapeSegment(segment)}`).join('');
}

/**
 * Enumerate every `import`-bearing node in a descriptor, each paired with the
 * key path to it. A node may both carry an `import` and nest further
 * param-bearing maps, so both are examined; only the maps a node of the given
 * kind can legally contain are descended. This is the read-only counterpart to
 * the resolver's inlining walk, shared by the pinner (which records each
 * import's digest) and the digest check (which validates it).
 *
 * @param {unknown} descriptor the parsed descriptor to scan
 * @param {string} schemaName the descriptor's schema kind (device, param, command)
 * @returns {Array<{path: string[], directive: object}>} imports in document order
 */
function collectImports(descriptor, schemaName) {
    const out = [];
    collect(descriptor, walkableFields(schemaName), [], out);
    return out;
}

/**
 * @param {unknown} node the node to inspect
 * @param {string[]} fields the param-bearing maps to descend at this level
 * @param {string[]} path the key path to `node`
 * @param {Array<{path: string[], directive: object}>} out collected imports
 */
function collect(node, fields, path, out) {
    if (!isPlainObject(node)) {
        return;
    }
    if (isPlainObject(node.import)) {
        out.push({ path, directive: node.import });
    }
    for (const field of fields) {
        const map = node[field];
        if (!isPlainObject(map)) {
            continue;
        }
        for (const key of Object.keys(map)) {
            collect(map[key], NESTED_FIELDS, [...path, field, key], out);
        }
    }
}

module.exports = { NESTED_FIELDS, ROOT_FIELDS, walkableFields, isPlainObject, fillGaps, shallowMerge, escapeSegment, unescapeSegment, toPointer, collectImports };
