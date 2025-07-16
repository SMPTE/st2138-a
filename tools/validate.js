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

const fs = require("fs");
const path = require("path");
const yaml = require("yaml");
const Ajv2020 = require("ajv/dist/2020");

// 1. Set up AJV for 2020-12 + unevaluatedProperties
const ajv = new Ajv2020({
  strict: true,
  strictSchema: true,
  strictRequired: true,
  unevaluated: true
});

// 2. Load the param YAML schema
const schemaPath = path.resolve(__dirname, "../interface/schemata/param.yaml");
const rawYaml = fs.readFileSync(schemaPath, "utf8");
const schema = yaml.parse(rawYaml);

// 3. Compile the schema
const validate = ajv.compile(schema);

// 4. Add formats
const addFormats = require('ajv-formats').default;
addFormats(ajv);

// 5. Validate an object that should be rejected
const testData = {
  wibble: "this should not be allowed"
};



'use strict';

class Validator {
    constructor(schemaDir = 'interface/schemata') {
 
        this.paramValidator = validate;
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
                return yaml.parse(inputData);
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
        console.log('Usage: node app.js path-to-file');
        console.log('  path-to-file: Path to the file to validate');
        console.log('  schema is inferred from the start of the filename');
        console.log('');
        console.log('Examples:');
        console.log('  node app.js examples/param.on_off.yaml');
        console.log('  node app.js examples/device.my_device.yaml');
        console.log('  node app.js examples/constraint.int_range.yaml');
        process.exit(1);
    }
    
    const filePath = args[0];
    const filename = path.basename(filePath);
    const schemaType = filename.split('.')[0]; // Get first part before dot
    
    try {
        const validator = new Validator();
        let isValid = false;
        
        console.log(`Detected schema type: ${schemaType}`);
        
        if (schemaType === 'param') {
            isValid = validator.validateParamFile(filePath);
        } else if (schemaType === 'device') {
            isValid = validator.validateDeviceFile(filePath);
        } else {
            console.error(`Unknown schema type: ${schemaType}. Expected 'param' or 'device'.`);
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