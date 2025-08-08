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
const testfile = process.argv[2];

if (!testfile) {
    console.log('Usage: node validate.js path/to/test/schema-name.object-name.json or .yaml');
    console.log('Example: node validate.js ./tests/device.my-device.json');
    console.log('Example: node validate.js ./tests/device.param.yaml');
    process.exit(1);
}

// extract schema name from input filename
const schemaName = path.parse(testfile).name.split('.')[0];
const schemaFile = path.join(__dirname, '../interface/schemata/device.json');

try {
    const validator = new Validator(schemaFile);
    console.log(`Applying schema '${schemaName}' to file '${testfile}'`);
    const isValid = validator.validate(schemaName, testfile);
    console.log(isValid ? '✅ Validation succeeded.' : '❌ Validation failed.');
    process.exit(isValid ? 0 : 2);
} catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(err.error || 1);
}