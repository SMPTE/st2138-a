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

// load the validation engine
const Ajv = require('ajv');
const addFormats = require('ajv-formats').default;
const ajv = new Ajv({strict: false});  
addFormats(ajv);

// load YAML parser
const YAML = require('yaml');

// our use of "strict" as a schema interferes with ajv's strict mode.
// so we only turn it on after loading ajv
'use strict';

// import the json-source-map library
// import the path and fs libraries
const path = require('node:path');
const fs = require('fs');
const jsonMap = require('json-source-map');

class Validator {
    constructor(schemaDir = 'interface/schemata') {
        let paramSchemaFile = path.join(schemaDir, 'param.yaml');
        if (!fs.existsSync(paramSchemaFile)) {
            // bail if we cannot open the schema definition file
            throw new Error(`Cannot open parameter schema file at: ${paramSchemaFile}`);
        }

        // read the schema definition files
        this.paramSchema = YAML.parse(fs.readFileSync(paramSchemaFile, 'utf8'));
        // Note: device schema not found, you may need to create it or remove device validation functionality

        // Remove the $schema and $id properties to avoid AJV conflicts
        const schemaForAjv = { ...this.paramSchema };
        delete schemaForAjv.$schema;
        delete schemaForAjv.$id;
        
        // Compile the schema directly instead of adding it
        this.paramValidator = ajv.compile(schemaForAjv);
    }

    /**
     * Parses input data from either JSON or YAML format
     * @param {string} inputData - The input data as a string
     * @param {string} format - The format ('json' or 'yaml'), if not provided it will be auto-detected
     * @returns {Object} - The parsed data object
     */
    parseInput(inputData, format = null) {
        if (!format) {
            // Auto-detect format based on content
            format = this.detectFormat(inputData);
        }

        try {
            if (format === 'yaml') {
                return YAML.parse(inputData);
            } else {
                return JSON.parse(inputData);
            }
        } catch (error) {
            throw new Error(`Failed to parse ${format.toUpperCase()} input: ${error.message}`);
        }
    }

    /**
     * Auto-detects the format of the input data
     * @param {string} inputData - The input data as a string
     * @returns {string} - 'json' or 'yaml'
     */
    detectFormat(inputData) {
        const trimmed = inputData.trim();
        
        // Check for JSON format (starts with { or [)
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            return 'json';
        }
        
        // Check for YAML format (contains YAML-specific patterns)
        if (trimmed.includes('---') || /^\s*\w+:\s*/.test(trimmed) || /^\s*-\s+/.test(trimmed)) {
            return 'yaml';
        }
        
        // Default to JSON if uncertain
        return 'json';
    }

    /**
     * Validates input file against device schema
     * @param {string} filePath - Path to the input file
     * @returns {boolean} - true if the data is valid, false otherwise
     */
    validateDeviceFile(filePath) {
        throw new Error('Device schema not available. Please create a device schema file or remove device validation functionality.');
    }

    /**
     * Validates input file against parameter schema
     * @param {string} filePath - Path to the input file
     * @returns {boolean} - true if the data is valid, false otherwise
     */
    validateParamFile(filePath) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Cannot open input file at: ${filePath}`);
        }

        const inputData = fs.readFileSync(filePath, 'utf8');
        const fileExtension = path.extname(filePath).toLowerCase();
        
        // Determine format based on file extension
        let format = 'json';
        if (fileExtension === '.yaml' || fileExtension === '.yml') {
            format = 'yaml';
        }

        const data = this.parseInput(inputData, format);
        return this.validateParam(data);
    }

    /**
     * validateDevice
     * @param {*} data - The data object to validate
     * @returns {boolean} - true if the data is valid, false otherwise
     */
    validateDevice(data) {
        throw new Error('Device schema not available. Please create a device schema file or remove device validation functionality.');
    }

    /**
     * validateParam
     * @param {*} data - The data object to validate
     * @returns {boolean} - true if the data is valid, false otherwise
     */
    validateParam(data) {
        let valid = false;
        if (this.paramValidator(data)) {
            console.log(`Input was valid against the parameter schema.`);
            valid = true;
        } else {
            this.showErrors(this.paramValidator.errors);
        }
        return valid;
    }

    /**
     * showErrors
     * Displays the validation errors
     */
    showErrors(errors = null) {
        const errorsToShow = errors || ajv.errors;
        if (!errorsToShow) {
            console.log('No errors found.');
            return;
        }
        for (const err of errorsToShow) {
            switch (err.keyword) {
                case "maximum":
                    console.log(err.limit);
                    break;
                default:
                    console.log(`${err.message} at ${err.instancePath}`);
                    break;
            }
        }
    }
}

// Main program execution
function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('Usage: node app.js <file-path> [schema-type]');
        console.log('  <file-path>: Path to the file to validate');
        console.log('  [schema-type]: "param" or "device" (default: param)');
        console.log('');
        console.log('Examples:');
        console.log('  node app.js examples/param.on_off.yaml');
        console.log('  node app.js examples/param.on_off.yaml param');
        process.exit(1);
    }
    
    const filePath = args[0];
    const schemaType = args[1] || 'param';
    
    try {
        const validator = new Validator();
        let isValid = false;
        
        if (schemaType === 'param') {
            isValid = validator.validateParamFile(filePath);
        } else if (schemaType === 'device') {
            isValid = validator.validateDeviceFile(filePath);
        } else {
            console.error(`Unknown schema type: ${schemaType}`);
            process.exit(1);
        }
        
        if (isValid) {
            console.log('✅ Validation successful!');
            process.exit(0);
        } else {
            console.log('❌ Validation failed!');
            process.exit(1);
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

// Run main program if this file is executed directly
if (require.main === module) {
    main();
}

// Export for use as a module
module.exports = Validator;