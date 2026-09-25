const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Given, When, Then } = require('@cucumber/cucumber');
const { parse } = require('yaml');
const st2138 = require('../../src/index');
const { computeDigest } = require('../../src/digest');

const casesDir = path.join(__dirname, '..', 'cases');
const modelsDir = path.join(__dirname, '..', 'models');
const fragmentsDir = path.join(__dirname, '..', 'fragments');

Given('the test case {word}', function (name) {
    this.dir = path.join(casesDir, name);
    const input = fs.readdirSync(this.dir).find((f) => /\.input\.(ya?ml|json)$/.test(f));
    assert.ok(input, `no input descriptor found in case "${name}"`);
    this.input = path.join(this.dir, input);
});

Given('the model {string}', function (name) {
    const model = path.join(modelsDir, name);
    assert.ok(fs.existsSync(model), `model "${name}" not found in models directory`);
    this.input = model;
});

// Each fragment's schema is chosen from its filename prefix (see
// schemaNameFromUrl), so a directory can mix subtypes that share a schema.
Given('the fragments in {string}', function (subdir) {
    const dir = path.join(fragmentsDir, subdir);
    assert.ok(fs.existsSync(dir), `fragments directory "${subdir}" not found`);
    this.fragments = fs.readdirSync(dir)
        .filter((f) => /\.(ya?ml|json)$/.test(f))
        .sort()
        .map((f) => path.join(dir, f));
    assert.ok(this.fragments.length > 0, `no fragments found in "${subdir}"`);
});

Then('they all validate', async function () {
    const failures = [];
    for (const file of this.fragments) {
        const result = await st2138.validate(file);
        if (!result.valid || result.diagnostics.length > 0) {
            const why = result.diagnostics.map((d) => d.message).join('; ') || 'invalid';
            failures.push(`${path.basename(file)}: ${why}`);
        }
    }
    assert.strictEqual(failures.length, 0, `fragments failed to validate:\n  ${failures.join('\n  ')}`);
});

Then('they all fail validation', async function () {
    const unexpected = [];
    for (const file of this.fragments) {
        const result = await st2138.validate(file);
        if (result.valid && result.diagnostics.length === 0) {
            unexpected.push(path.basename(file));
        }
    }
    assert.strictEqual(unexpected.length, 0, `fragments validated but should have failed:\n  ${unexpected.join('\n  ')}`);
});

When('passed to {word}', async function (func) {
    assert.strictEqual(typeof st2138[func], 'function', `function "${func}" not found in st2138`);
    this.result = await st2138[func](this.input);
});

Then('the function succeeds with no diagnostics', function () {
    assert.strictEqual(this.result.valid, true, `result is not valid (valid=${this.result.valid})`);
    assert.strictEqual(this.result.diagnostics.length, 0, `result has ${this.result.diagnostics.length} diagnostic(s), wanted 0`);
});

Then(/^the output "(.+?)" (?:is|are)( not)? there$/, function (name, not) {
    const expectAbsent = Boolean(not);
    const expected = path.join(this.dir, `expected.${name}.yaml`);
    if (expectAbsent) {
        assert.ok(!this.result[name] || Object.keys(this.result[name]).length === 0, `unexpected "${name}" in result`);
        assert.ok(!fs.existsSync(expected), `unexpected file ${expected}`);
        return;
    }
    assert.ok(this.result[name], `missing "${name}" in result`);
    assert.deepStrictEqual(this.result[name], parse(fs.readFileSync(expected, 'utf8')));
});

// The imports record carries two content-derived fields that don't compare
// cleanly by value: the url (an absolute file:// path, machine-specific) and
// the digest (brittle to pin literally). This step normalizes urls to the case
// dir and verifies each digest by rehashing the bytes on disk, so the expected
// artifact holds only the stable shape (relative urls, edges, provenance).
Then('the resolved imports match', function () {
    assert.ok(this.result.imports, 'missing "imports" in result');
    const base = `${pathToFileURL(this.dir).href}/`;
    const rel = (url) => (url.startsWith(base) ? url.slice(base.length) : url);
    const expected = parse(fs.readFileSync(path.join(this.dir, 'expected.imports.yaml'), 'utf8'));

    const actual = this.result.imports.map((record) => {
        const url = rel(record.url);
        const onDisk = fs.readFileSync(path.join(this.dir, url), 'utf8');
        assert.strictEqual(record.digest, computeDigest(onDisk), `digest mismatch for ${url}`);
        return { url, dependencies: record.dependencies.map(rel), provenance: record.provenance };
    });

    assert.deepStrictEqual(actual, expected);
});
