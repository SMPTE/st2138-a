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
 * Descriptor-declared provenance.
 *
 * A descriptor may state who produced it, under what license, at what version,
 * and its copyright — self-assertions only its author can make truthfully. These
 * are read from a structured comment block at the top of the file, so they live
 * in the artifact but never enter the parsed model, and the descriptor schema
 * stays closed (`additionalProperties: false`) with no key to declare.
 *
 * The tags follow the SPDX/REUSE convention where one exists — `SPDX-License-
 * Identifier` and `SPDX-FileCopyrightText`, the canonical forms third-party
 * scanners already read — and a small `st2138-` namespace for the fields SPDX
 * has no file-level tag for (supplier, version):
 *
 *     # SPDX-FileCopyrightText: 2026 SMPTE
 *     # SPDX-License-Identifier: BSD-3-Clause
 *     # st2138-supplier: SMPTE <https://www.smpte.org>
 *     # st2138-version: 1.2.0
 *
 * Only comments carry provenance, so this is YAML-only by construction: a JSON
 * descriptor begins with model content and thus declares nothing here, which is
 * why a published, importable descriptor should be YAML. Any recognized tag may
 * sit anywhere in the leading comment block, interleaved with the free-form
 * description comments descriptors already carry; unrecognized lines are ignored.
 */

'use strict';

/**
 * Comment tags mapped to the provenance field each supplies. SPDX tags are the
 * canonical form where one exists; the rest use the `st2138-` namespace.
 */
const TAGS = {
    'SPDX-License-Identifier': 'license',
    'SPDX-FileCopyrightText': 'copyright',
    'st2138-supplier': 'producer',
    'st2138-version': 'version',
};

/**
 * Read a descriptor's self-declared provenance from its leading comment block.
 * Scans from the top of the file, skipping blank lines, until the first line of
 * model content; within that block, each `# Tag: value` line whose tag is
 * recognized contributes its field. Only fields actually declared appear in the
 * result — an absent or empty tag is left unset, to be recorded as an explicit
 * Unknown downstream rather than guessed.
 *
 * @param {string} raw the descriptor's raw text
 * @returns {{ producer?: string, license?: string, version?: string, copyright?: string }}
 */
function parseProvenance(raw) {
    const provenance = {};
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '') {
            continue;                    // a blank line stays within the header
        }
        if (!trimmed.startsWith('#')) {
            break;                       // the first model content ends the header
        }
        const body = trimmed.slice(1).trim();
        const colon = body.indexOf(':');
        if (colon === -1) {
            continue;                    // a free-form description line, not a tag
        }
        const field = TAGS[body.slice(0, colon)];
        const value = body.slice(colon + 1).trim();
        if (field && value) {
            provenance[field] = value;
        }
    }
    return provenance;
}

module.exports = { parseProvenance };
