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
 * Generates the JSON schemas from the YAML schemas.
 * Motivation: YAML is easier to read and write than JSON.
 * However, the live validation in tools such as vscode and cursor
 * require JSON schemas.
 * 
 * The output is put into the interface/schemata/json folder which is 
 * excluded from the git repository by a line in .gitignore.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("yaml");

const schemaDir = path.resolve(__dirname, "../interface/schemata");
const jsonDir = path.resolve(__dirname, "../interface/schemata/json");

try {
    const files = fs.readdirSync(schemaDir);
    const yamlFiles = files.filter(file => file.endsWith(".yaml"));
    for (const yamlFile of yamlFiles) {
        const yamlPath = path.join(schemaDir, yamlFile);
        const yamlText = fs.readFileSync(yamlPath, "utf8");
        const schema = yaml.parse(yamlText);
        const jsonSchema = JSON.stringify(schema, null, 2);
        const jsonPath = path.join(jsonDir, yamlFile.replace(".yaml", ".json"));
        fs.writeFileSync(jsonPath, jsonSchema);
    }
} catch (error) {
    console.error("Error reading schema directory:", error);
    process.exit(1);
}



