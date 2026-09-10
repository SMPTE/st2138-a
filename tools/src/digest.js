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
 * Digest encoding.
 *
 * The spec stores import digests as base64 (schema `contentEncoding: base64`),
 * and the CLI accepts them in the same form, but the loader verifies integrity
 * by comparing raw bytes. This is the single place that knows that external
 * encoding, so the loader can stay byte-oriented and every caller that receives
 * a digest from a file or the command line decodes it the same way.
 */

'use strict';

const crypto = require('node:crypto');

/** Byte length of a sha256 digest. */
const SHA256_BYTES = 32;

/** Length of a base64-encoded sha256: 44 characters padded, 43 without the `=`. */
const SHA256_BASE64_PADDED = 44;
const SHA256_BASE64_UNPADDED = 43;

/**
 * Decode a base64 sha256 digest into the raw bytes the loader compares against.
 * A null/absent digest passes through as null ("do not verify").
 *
 * `Buffer.from(..., 'base64')` is lenient: it silently drops any character
 * outside the alphabet, so a malformed value (e.g. an appended `!`) can still
 * decode to 32 bytes. Dropping a character can only shorten the output, so
 * checking the length on both sides of the decode closes that gap — an input of
 * the right size that still yields a full 32 bytes cannot have had any character
 * ignored.
 * @param {string|null} [digest] base64-encoded sha256 digest, or null
 * @returns {Buffer|null} the decoded 32 bytes, or null when no digest was given
 * @throws {Error} if the value is not a base64-encoded sha256
 */
function decodeDigest(digest) {
    if (!digest) {
        return null;
    }
    const sized =
        digest.length === SHA256_BASE64_UNPADDED ||
        (digest.length === SHA256_BASE64_PADDED && digest.endsWith('='));
    const bytes = sized ? Buffer.from(digest, 'base64') : null;
    if (!bytes || bytes.length !== SHA256_BYTES) {
        throw new Error(`Invalid digest: expected a base64-encoded sha256 (${SHA256_BYTES} bytes)`);
    }
    return bytes;
}

/**
 * Hash a descriptor's bytes into a base64 sha256 digest — the same encoding the
 * spec and CLI use to store one. The loader reports this as provenance and the
 * digest CLI writes it into a descriptor; {@link digestsMatch} compares it
 * against a declared digest.
 * @param {string|Buffer} data the descriptor bytes to hash
 * @returns {string} the base64-encoded sha256 digest
 */
function computeDigest(data) {
    return crypto.createHash('sha256').update(data).digest('base64');
}

/**
 * Whether two base64 sha256 digests denote the same bytes. The comparison is on
 * the decoded bytes, not the strings, so it is blind to base64 spelling (padding,
 * url-safe alphabet): two encodings of the same hash still match.
 * @param {string} a base64 sha256 digest
 * @param {string} b base64 sha256 digest
 * @returns {boolean} true when the two digests are byte-for-byte equal
 */
function digestsMatch(a, b) {
    return decodeDigest(a).equals(decodeDigest(b));
}

module.exports = { decodeDigest, computeDigest, digestsMatch };
