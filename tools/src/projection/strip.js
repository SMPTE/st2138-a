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
 * Definition-stripping pass.
 *
 * Once templates are expanded, a definition-only param has done its job: its
 * shape lives on in the consumers that borrowed it, and it should not appear as
 * a runtime device parameter. This pass splits the expanded tree into the views
 * a resolution produces — the runtime device model, the definitions code
 * generation still needs, and the references that tie them back together.
 *
 * A param that is definition-only at its own site (a namespace root or an
 * explicit definition-only) is lifted out whole: its subtree is recorded as a
 * definition, keyed by its FQOID and tagged with its namespace, and it is
 * dropped from the runtime model. Because the whole subtree leaves together,
 * definition-only scope is inherited for free — descendants are never reached.
 *
 * A runtime param stays, minus the `template_oid` that has now been resolved
 * away. Rather than lose that linkage, its runtime FQOID is recorded against the
 * source it drew from, so code generation can follow a runtime param back to the
 * definition it was built from and name a shared type. The walk descends into
 * the param's own params to lift any definition-only children nested beneath it.
 * The walk mutates the expanded tree in place — the caller (`project`) hands it
 * a private clone — deleting definition-only params and each resolved-away
 * `template_oid`. A lifted definition is the same object removed from the
 * runtime tree, so the two views never alias.
 */

'use strict';

const { isPlainObject } = require('../shape');
const { isDefinitionOnly, namespaceOf } = require('../hints');

/**
 * Split an expanded device descriptor into a runtime model, its definitions, and
 * the references that tie the two together. The `data` is `root` itself, mutated
 * in place (the caller clones), with definition-only params removed. The two
 * sidecars are maps keyed by FQOID: `definitions` for lookup by a template's
 * source OID, `references` for the runtime OID that borrowed it.
 * @param {object} root the expanded device descriptor (mutated)
 * @returns {{ data: object, definitions: Record<string, import('../types').Definition>, references: Record<string, string> }}
 */
function stripDefinitions(root) {
    const definitions = {};
    const references = {};
    if (isPlainObject(root.params)) {
        stripParams(root.params, '', definitions, references);
    }
    return { data: root, definitions, references };
}

/**
 * Strip a param map in place: delete every definition-only param, recording its
 * subtree in `definitions` keyed by FQOID; leave runtime params for cleanup.
 * @param {object} params a param map (mutated)
 * @param {string} prefix FQOID of the map's owner (empty at the device root)
 * @param {Record<string, import('../types').Definition>} definitions accumulator, keyed by FQOID
 * @param {Record<string, string>} references accumulator, runtime FQOID → source FQOID
 */
function stripParams(params, prefix, definitions, references) {
    for (const key of Object.keys(params)) {
        const node = params[key];
        const oid = prefix ? `${prefix}/${key}` : key;
        if (isDefinitionOnly(node)) {
            definitions[oid] = { namespace: namespaceOf(node) ?? undefined, node };
            delete params[key];
            continue;
        }
        stripRuntimeNode(node, oid, definitions, references);
    }
}

/**
 * Clean a runtime param in place: record where its resolved-away `template_oid`
 * pointed before dropping it, and recurse into its own params to lift nested
 * definitions.
 * @param {unknown} node a runtime param (mutated)
 * @param {string} oid the param's FQOID
 * @param {Record<string, import('../types').Definition>} definitions accumulator, keyed by FQOID
 * @param {Record<string, string>} references accumulator, runtime FQOID → source FQOID
 */
function stripRuntimeNode(node, oid, definitions, references) {
    if (!isPlainObject(node)) return;
    // The linkage leaves the runtime model but survives as provenance: codegen
    // follows it into `definitions` to name a shared type.
    if (typeof node.template_oid === 'string') {
        references[oid] = node.template_oid;
    }
    delete node.template_oid;
    if (isPlainObject(node.params)) {
        stripParams(node.params, oid, definitions, references);
    }
}

module.exports = { stripDefinitions };
