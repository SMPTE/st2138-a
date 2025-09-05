const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats').default;

const jsonMap = require('json-source-map');
const fs = require('fs');
const path = require('node:path');
const yaml = require('yaml');
const schema = require('./data/device.json');

'use strict'; // <-- now applied after AJV is safely loaded

class Validator {
    constructor() {

        this.ajv = new Ajv({
            strict: true,
            strictSchema: true,
            strictRequired: true,
            unevaluated: true
        });
        addFormats(this.ajv);

        this.addSchemas('$defs');
    }

    addSchemas(genus) {
        const schemaMap = jsonMap.stringify(schema, null, 2);
        for (const species in schema[genus]) {
            if (!Object.prototype.hasOwnProperty.call(schema[genus], species)) continue;
            if (species.startsWith('$comment')) continue;

            try {
                this.ajv.addSchema(schema[genus][species], `#/${genus}/${species}`);
            } catch (err) {
                const errorPointer = schemaMap.pointers[`/${genus}/${species}`];
                throw new Error(`${err.message} at #/${genus}/${species} on lines ${errorPointer.value.line}-${errorPointer.valueEnd.line}`);
            }
        }
    }

    static loadTestData(filePath) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Cannot open file at ${filePath}`);
        }

        const ext = path.extname(filePath).toLowerCase();
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = ext === '.yaml' || ext === '.yml' ? yaml.parse(raw) : JSON.parse(raw);

        return {
            data,
            sourceMap: jsonMap.stringify(data, null, 2)
        };
    }

    validate(schemaName, filePath) {
        const { data, sourceMap } = Validator.loadTestData(filePath);

        const isDeviceSchema = schemaName.startsWith('device');
        if (!isDeviceSchema && !(schemaName in schema.$defs)) {
            throw { error: 2, message: `Could not find ${schemaName} in schema definition file.` };
        }

        let valid, errors;
        if (isDeviceSchema) {
            const validate = this.ajv.compile(schema);
            valid = validate(data);
            errors = validate.errors;
        } else {
            valid = this.ajv.validate(schema.$defs[schemaName], data);
            errors = this.ajv.errors;
        }

        if (!valid) {
            Validator.showErrors(errors, sourceMap);
            return {valid: false}
        }

        return {valid: true, data: data};
    }

    static showErrors(errors, sourceMap) {
        for (const err of errors) {
            const pointer = sourceMap.pointers[err.instancePath];
            const lineInfo = pointer ? ` on lines ${pointer.value.line}-${pointer.valueEnd.line}` : '';
            console.log(`${err.message} at ${err.instancePath}${lineInfo}`);
        }
    }
}

module.exports = Validator;