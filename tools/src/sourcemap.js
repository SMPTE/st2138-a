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
 * Source mapping.
 *
 * Parses a descriptor and hands back its data plus a resolver that, on demand,
 * reports where a given node lives in the *original* text — addressed by JSON
 * pointer (RFC 6901), the same instance paths AJV and the checks report.
 * Because YAML 1.2 is a superset of JSON, one parser serves both formats, and
 * the line numbers refer to the file the author actually wrote (not a
 * re-serialization).
 *
 * Resolution is lazy: validation usually succeeds and no positions are ever
 * needed, so rather than walk the whole tree up front we retain the parsed
 * document and navigate to a node only when a diagnostic asks for its lines.
 * Lines are 1-based.
 */

'use strict';

const { parseDocument, LineCounter } = require('yaml');

/**
 * @typedef SourceMap
 * @property {(pointer: string) => ({start: number, end: number} | null)} linesFor
 *   Resolve a JSON pointer to the line range of its node, or null when the
 *   pointer addresses nothing (an absent path or an empty document).
 */

/** Decode a JSON pointer segment back into a raw key (RFC 6901). */
function unescapeSegment(segment) {
    return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Parse descriptor text into its data and a source map that resolves JSON
 * pointers to 1-based line ranges in the original text, on demand.
 *
 * @param {string} raw descriptor text (YAML or JSON)
 * @returns {{data: unknown, sourceMap: SourceMap}}
 * @throws if the text is not well-formed
 */
function parse(raw) {
    const lineCounter = new LineCounter();
    const doc = parseDocument(raw, { lineCounter });
    if (doc.errors.length > 0) {
        throw doc.errors[0];
    }

    /**
     * Resolve a JSON pointer to the line range of its node, or null when the
     * pointer addresses nothing (an absent path or an empty document).
     * @param {string} pointer RFC 6901 JSON pointer ('' is the document root)
     * @returns {{start: number, end: number} | null}
     */
    const linesFor = (pointer) => {
        const node = pointer === ''
            ? doc.contents
            : doc.getIn(pointer.split('/').slice(1).map(unescapeSegment), true);
        if (!node) return null;
        return {
            start: lineCounter.linePos(node.range[0]).line,
            end: lineCounter.linePos(node.range[1]).line,
        };
    };

    return { data: doc.toJS(), sourceMap: { linesFor } };
}

module.exports = { parse };
