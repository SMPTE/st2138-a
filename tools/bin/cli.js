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
const { stringify } = require('yaml');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
const { validate, resolve, toCycloneDx, printDiagnostics, formatDiagnostic } = require('../src');
const { toUrl, schemaNameFromUrl } = require('../src/urls');

'use strict';

/**
 * Decide the serialization format for `resolve` output. An explicit `--json` or
 * `--yaml` wins; otherwise the format is inferred from an `--output` file's
 * extension; otherwise it defaults to YAML.
 */
function outputFormat({ json, yaml, output }) {
    if (json && yaml) {
        throw new Error('choose either --json or --yaml, not both');
    }
    if (json) return 'json';
    if (yaml) return 'yaml';
    if (output && path.extname(output).toLowerCase() === '.json') return 'json';
    return 'yaml';
}

/** Serialize a resolved descriptor as YAML or pretty JSON, each newline-terminated. */
function serialize(data, format) {
    return format === 'json' ? `${JSON.stringify(data, null, 2)}\n` : stringify(data);
}

program
    .name('st2138')
    .description('Tooling for SMPTE ST 2138-a device models and parameter descriptors')
    .version(pkg.version);

program
    .command('validate')
    .description('Validate a device model or parameter descriptor against the ST 2138-a schema')
    .argument('<file>', 'path or URL to a .json or .yaml descriptor')
    .option('--digest <digest>', 'optional base64 sha256 digest to verify the file against')
    .option('--resolve', 'resolve imports and validate the merged descriptor')
    .option('--disable-mandatory-enforcement', 'skip mandatory product parameter checks')
    .action(async (file, options) => {
        const url = toUrl(file);
        console.log(`Applying schema '${schemaNameFromUrl(url)}' to '${url}'`);

        const run = options.resolve ? resolve : validate;
        const result = await run(url, {
            digest: options.digest,
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

program
    .command('resolve')
    .description('Resolve a descriptor\'s imports into a single self-contained descriptor')
    .argument('<file>', 'path or URL to a .json or .yaml descriptor')
    .option('--digest <digest>', 'optional base64 sha256 digest to pin the root file against')
    .option('--output <file>', 'write the descriptor to a file instead of stdout')
    .option('--json', 'emit JSON (default: YAML, or inferred from --output extension)')
    .option('--yaml', 'emit YAML (the default)')
    .option('--sbom <file>', 'also write a CycloneDX SBOM of the resolved files to a file')
    .option('--disable-mandatory-enforcement', 'skip mandatory product parameter checks')
    .action(async (file, options) => {
        const format = outputFormat(options);
        const url = toUrl(file);
        const result = await resolve(url, {
            digest: options.digest,
            disableMandatoryParams: Boolean(options.disableMandatoryEnforcement)
        });

        // Diagnostics go to stderr so stdout carries only the descriptor itself,
        // ready to be redirected to a file.
        for (const diagnostic of result.diagnostics) {
            console.error(formatDiagnostic(diagnostic));
        }

        if (!result.valid) {
            console.error('❌ Resolution failed.');
            process.exitCode = 2;
            return;
        }

        const text = serialize(result.data, format);
        if (options.output) {
            fs.writeFileSync(options.output, text);
        } else {
            process.stdout.write(text);
        }

        // The SBOM is orthogonal to the descriptor output: a machine artifact
        // with only one useful home, a file, so it never touches stdout.
        if (options.sbom) {
            fs.writeFileSync(options.sbom, `${JSON.stringify(toCycloneDx(result, url), null, 2)}\n`);
        }
    });

program.parseAsync(process.argv).catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(err.error || 1);
});
