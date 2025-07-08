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
    constructor(schemaDir) {
        let deviceSchemaFile = path.join(schemaDir, 'catena.device_schema.json');
        let paramSchemaFile = path.join(schemaDir, 'catena.param_schema.json');
        if (!fs.existsSync(deviceSchemaFile)) {
            // bail if we cannot open the schema definition file
            throw new Error(`Cannot open device schema file at: ${deviceSchemaFile}`);
        }
        if (!fs.existsSync(paramSchemaFile)) {
            // bail if we cannot open the schema definition file
            throw new Error(`Cannot open parameter schema file at: ${paramSchemaFile}`);
        }

        // read the schema definition files
        this.deviceSchema = JSON.parse(fs.readFileSync(deviceSchemaFile, 'utf8'));
        this.paramSchema = JSON.parse(fs.readFileSync(paramSchemaFile, 'utf8'));

        ajv.addSchema(this.deviceSchema);
        ajv.addSchema(this.paramSchema);
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
        let valid = false;
        const schema = this.deviceSchema;
        if (ajv.validate(schema, data)) {
            console.log(`Input was valid against the device schema.`);
            valid = true;
        } else {
            this.showErrors();
        }
        return valid;
    }

    /**
     * validateParam
     * @param {*} data - The data object to validate
     * @returns {boolean} - true if the data is valid, false otherwise
     */
    validateParam(data) {
        let valid = false;
        const schema = this.paramSchema;
        if (ajv.validate(schema, data)) {
            console.log(`Input was valid against the parameter schema.`);
            valid = true;
        } else {
            this.showErrors();
        }
        return valid;
    }

    /**
     * showErrors
     * Displays the validation errors
     */
    showErrors() {
        if (!ajv.errors) {
            console.log('No errors found.');
            return;
        }
        for (const err of ajv.errors) {
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

module.exports = Validator;