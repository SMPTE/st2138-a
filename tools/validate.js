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
 * Validates input against the Catena json-schema.
 * Supports both JSON and YAML input formats.
 */




const path = require('node:path');
const Validator = require('./validator');
const { validateRequiredParamsAndScopes } = require('./mandatory');
'use strict'; // <-- now applied after AJV is safely loaded (via validator.js)

const disableMandatory = process.argv.includes('--disable-mandatory-enforcement');
const args = process.argv.filter(a => !a.startsWith('--'));

// get file from command line
let testfile = args[2];

if (!testfile) {
    console.log('Usage: node validate.js [options] path/to/test/schema-name.object-name.json or .yaml [digest]');
    console.log('Options:');
    console.log('  --disable-mandatory-enforcement   Skip mandatory product parameter checks');
    console.log('Example: node validate.js ./tests/device.my-device.json');
    console.log('Example: node validate.js ./tests/device.param.yaml sha256digest');
    process.exit(1);
}

// convert to URL
if (testfile.indexOf('://') === -1) {
    testfile = 'file://' + path.resolve(testfile);
}
const url = new URL(testfile);

// extract schema name from input filename
const schemaName = path.parse(url.pathname).name.split('.')[0];

const digest = args[3] || null;

(async () => {
    const validator = new Validator();
    console.log(`Applying schema '${schemaName}' to '${url}'`);
    const ans = await validator.validate(schemaName, url, digest);

    if (!ans.valid) {
        console.log('❌ Validation failed.');
        process.exit(2);
    }

    console.log('✅ Schema validation succeeded.');

    if (schemaName.startsWith('device')) {
        if (disableMandatory) {
            console.log('Mandatory parameter enforcement disabled.');
        } else {
            validateRequiredParamsAndScopes(ans.data);
            console.log('✅ Mandatory parameter validation succeeded.');
        }
    }

    process.exit(0);
})().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(err.error || 1);
});
