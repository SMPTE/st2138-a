#!/usr/bin/env node

/*
 * Copyright (c) by the Society of Motion Picture and Television Engineers
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 * list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 * this list of conditions and the following disclaimer in the documentation and/or
 * other materials provided with the distribution.
 */

/*
 * Command line entry point for the st2138-a tools.
 *
 * This file is intentionally a thin routing layer: it parses arguments and
 * delegates to the library in ../src. Business logic lives in the library so
 * it can be reused by consumers that import the package directly.
 */

const path = require('node:path');
const { program } = require('commander');
const pkg = require('../package.json');
const Validator = require('../src/validator');

'use strict';

/**
 * Resolve a CLI file argument into a URL the library understands.
 * @param {string} testfile a path or URL
 * @returns {URL}
 */
function toUrl(testfile) {
    if (testfile.indexOf('://') === -1) {
        testfile = 'file://' + path.resolve(testfile);
    }
    return new URL(testfile);
}

/**
 * Derive the schema name from a descriptor filename, e.g. `device.example.yaml`
 * -> `device`.
 * @param {URL} url
 * @returns {string}
 */
function schemaNameFromUrl(url) {
    return path.parse(url.pathname).name.split('.')[0];
}

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
        const schemaName = schemaNameFromUrl(url);

        const validator = new Validator({
            disableMandatoryParams: Boolean(options.disableMandatoryEnforcement)
        });

        console.log(`Applying schema '${schemaName}' to '${url}'`);
        const ans = await validator.validate(schemaName, url, digest || null);

        if (!ans.valid) {
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
