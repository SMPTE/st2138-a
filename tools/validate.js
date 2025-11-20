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
'use strict'; // <-- now applied after AJV is safely loaded (via validator.js)

// get file from command line
let testfile = process.argv[2];

if (!testfile) {
    console.log('Usage: node validate.js path/to/test/schema-name.object-name.json or .yaml [digest]');
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

const digest = process.argv[3] || null;

(async () => {
    const validator = new Validator();
    console.log(`Applying schema '${schemaName}' to '${url}'`);
    const ans = await validator.validate(schemaName, url, digest);
    console.log(ans.valid ? '✅ Validation succeeded.' : '❌ Validation failed.');
    process.exit(ans.valid ? 0 : 2);
})().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(err.error || 1);
});
