#!/usr/bin/env node

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
 * Command line entry point for the st2138-a tools.
 *
 * This file is intentionally a thin routing layer: it parses arguments and
 * delegates to the library in ../src. Business logic lives in the library so
 * it can be reused by consumers that import the package directly.
 */

const { program } = require('commander');
const pkg = require('../package.json');
const { validate, printDiagnostics } = require('../src');
const { toUrl, schemaNameFromUrl } = require('../src/urls');

'use strict';

program
    .name('st2138')
    .description('Tooling for SMPTE ST 2138-a device models and parameter descriptors')
    .version(pkg.version);

program
    .command('validate')
    .description('Validate a device model or parameter descriptor against the ST 2138-a schema')
    .argument('<file>', 'path or URL to a .json or .yaml descriptor')
    .argument('[digest]', 'optional sha256 digest to verify the file against')
    .option('--disable-mandatory-enforcement', 'skip mandatory product parameter checks')
    .action(async (file, digest, options) => {
        const url = toUrl(file);
        console.log(`Applying schema '${schemaNameFromUrl(url)}' to '${url}'`);

        const result = await validate(url, {
            digest: digest || null,
            disableMandatoryParams: Boolean(options.disableMandatoryEnforcement)
        });

        printDiagnostics(result.diagnostics);

        if (!result.valid) {
            console.log('❌ Validation failed.');
            process.exitCode = 2;
            return;
        }

        console.log('✅ Schema validation succeeded.');
    });

program.parseAsync(process.argv).catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(err.error || 1);
});
