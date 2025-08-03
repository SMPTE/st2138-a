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

const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats').default;

const ajv = new Ajv({
    strict: true,
    strictSchema: true,
    strictRequired: true,
    unevaluated: true
});  
addFormats(ajv);


const jsonMap = require('json-source-map');

'use strict';
const path = require('node:path');
const fs = require('fs');
const yaml = require('yaml');

// get the file to validate from the command line
const testfile = process.argv[2];

// validate command line
if (testfile === undefined) {
    console.log('Usage: node validate.js path/to/test/schema-name.object-name.json or .yaml');
    console.log('Example: nodejs validate.js ./tests/device.my-device.json\nWill apply the device schema to a device coded in JSON.');
    console.log('Example: nodejs validate.js ./tests/device.param.yaml\nWill apply the param schema to a param coded in YAML.');
    process.exit(1);
}

// verify input file exists
if (!fs.existsSync(testfile)) {
    console.log(`Cannot open file at ${testfile}`);
    process.exit(1);
}

// extract schema name from input filename
const schemaName = path.parse(testfile).name.split('.')[0];

// read the schema definition file
const schemaFilename = '../interface/schemata/device.json';
if (!fs.existsSync(schemaFilename)) {
    console.log(`Cannot open schema file at: ${schemaFilename}`);
    process.exit(1);
}

// read the schema definition file into the schema variable
let schema = JSON.parse(fs.readFileSync(schemaFilename));

// let the user know what we're doing
console.log(`applying: ${schemaName} schema to input file ${testfile}`);

// adds schemas to the avj engine
function addSchemas(genus) {
    let schemaMap = jsonMap.stringify(schema, null, 2)

    for (species in schema[genus]) {
        if (species.indexOf('$comment') === 0) {
            // ignore comments
        } else {
            // treat as a schema
            try {
                ajv.addSchema(schema[genus][species], `#/${genus}/${species}`);
            } catch (why) {
                let errorPointer = schemaMap.pointers[`/${genus}/${species}`];

                throw Error(`${why} at #/${genus}/${species} on lines ${errorPointer.value.line}-${
                  errorPointer.valueEnd.line}`)
            }
        }
    }
}

// show errors
function showErrors(errors, sourceMap) {
    for (const err of errors) {
        switch (err.keyword) {
            case "maximum":
                console.log(err.limit);
                break;
            default:
                let errorPointer = sourceMap.pointers[err.instancePath];
                console.log(`${err.message} at ${err.instancePath} on lines ${errorPointer.value.line}-${
                  errorPointer.valueEnd.line}`);
                break;
        }
    }
}

const kDeviceSchema = schemaName.indexOf('device') === 0;

try {
    // the sub-schemas are under $defs, so add them
    addSchemas('$defs');
    if (!kDeviceSchema && !(schemaName in schema.$defs)) {
        throw {error: 2, message: `Could not find ${schemaName} in schema definition file.`};
    }

    // read the file to validate
    // if the file is a YAML file, parse it as YAML
    // otherwise, parse it as JSON
    let data;
    if (testfile.endsWith('.yaml')) {
        data = yaml.parse(fs.readFileSync(testfile, 'utf8'));
    } else {
        data = JSON.parse(fs.readFileSync(testfile));
    }
    const map = jsonMap.stringify(data, null, 2);

    if (kDeviceSchema) {
        const validate = ajv.compile(schema);
        if (validate(data)) {
            console.log('Device model is valid.');
        } else {
            showErrors(validate.errors, map);
        }
    } else {
        if (ajv.validate(schema.$defs[schemaName], data)) {
            console.log('data was valid.');
        } else {
            showErrors(ajv.errors, map);
        }
    }

} catch (why) {
    console.log(why.message);
    process.exit(why.error);
}
