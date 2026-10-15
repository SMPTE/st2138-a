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

const { parseProvenance } = require('../src/provenance');

describe('parseProvenance', () => {
    test('reads the hybrid SPDX/st2138 tags from the leading comment block', () => {
        const raw = [
            '# SPDX-FileCopyrightText: 2026 SMPTE',
            '# SPDX-License-Identifier: BSD-3-Clause',
            '# st2138-supplier: SMPTE <https://www.smpte.org>',
            '# st2138-version: 1.2.0',
            'name: gain',
            'type: FLOAT32'
        ].join('\n');

        expect(parseProvenance(raw)).toEqual({
            copyright: '2026 SMPTE',
            license: 'BSD-3-Clause',
            producer: 'SMPTE <https://www.smpte.org>',
            version: '1.2.0'
        });
    });

    test('ignores free-form description comments and blank lines within the header', () => {
        // the descriptive comments descriptors already carry, and a blank line
        // separating them from the provenance block, are both skipped
        const raw = [
            '# Example of a simple on/off parameter',
            '# the UI is hinted to use a button',
            '',
            '# st2138-version: 3.0.0',
            'name: on_off'
        ].join('\n');

        expect(parseProvenance(raw)).toEqual({ version: '3.0.0' });
    });

    test('stops at the first line of model content, ignoring later comments', () => {
        // a tag below the header (an inline comment deep in the file) is not read
        const raw = [
            '# st2138-supplier: SMPTE',
            'name: gain',
            '# SPDX-License-Identifier: MIT'
        ].join('\n');

        expect(parseProvenance(raw)).toEqual({ producer: 'SMPTE' });
    });

    test('skips a recognized tag whose value is empty', () => {
        expect(parseProvenance('# st2138-version:\nname: gain')).toEqual({});
    });

    test('skips an unrecognized tag', () => {
        expect(parseProvenance('# some-other-key: value\nname: gain')).toEqual({});
    });

    test('returns nothing for a descriptor that begins with model content', () => {
        // JSON descriptors, and any comment-free YAML, declare no provenance
        expect(parseProvenance('{"name":"gain"}')).toEqual({});
        expect(parseProvenance('name: gain\ntype: FLOAT32\n')).toEqual({});
    });
});
