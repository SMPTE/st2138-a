const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Given, When, Then } = require('@cucumber/cucumber');
const { stringify, parse } = require('yaml');
const st2138 = require('../../src/index');

const casesDir = path.join(__dirname, '..', 'cases');

// Serialize a resolved view exactly as the CLI writes it, so the expected file
// is the real artifact a user would see, not a test-only encoding.
const serialize = (view) => stringify(view);

Given('the test case {word}', function (name) {
    this.dir = path.join(casesDir, name);
    const input = fs.readdirSync(this.dir).find((f) => /\.input\.(ya?ml|json)$/.test(f));
    assert.ok(input, `no input descriptor found in case "${name}"`);
    this.input = path.join(this.dir, input);
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
