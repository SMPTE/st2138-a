/*
 * Copyright © MMXXVI 2026 by the Society of Motion Picture and Television Engineers
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation and/or
 *    other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
 * ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

'use strict';

const crypto = require('node:crypto');

// Template expansion has its own suite (tests/templates.test.js); here it is
// mocked to a spy so these tests assert only the wiring — that resolve calls it
// with the resolved tree and threads its result through — not its structural
// behavior.
jest.mock('../src/templates');
const { expandTemplates } = require('../src/templates');
const { mergeImported, resolve } = require('../src/resolve');

describe('mergeImported', () => {
    test('local scalars override imported scalars', () => {
        // an import may carry a placeholder default; the local value is real
        expect(mergeImported({ value: 0 }, { value: 42 })).toEqual({ value: 42 });
    });

    test('keys present in only one side both survive', () => {
        const base = { oid: '0x01', type: 'INT32' };
        const local = { value: 42 };
        expect(mergeImported(base, local)).toEqual({ oid: '0x01', type: 'INT32', value: 42 });
    });

    test('nested mappings merge key-by-key (e.g. per-language help)', () => {
        // en is overridden locally; fr exists only in the import and must survive
        const base = { help: { en: 'imported', fr: 'aide' } };
        const local = { help: { en: 'overridden' } };
        expect(mergeImported(base, local)).toEqual({
            help: { en: 'overridden', fr: 'aide' }
        });
    });

    test('a local scalar replaces an imported mapping wholesale', () => {
        expect(mergeImported({ a: { deep: 1 } }, { a: 5 })).toEqual({ a: 5 });
    });

    test('a local mapping replaces an imported scalar wholesale', () => {
        expect(mergeImported({ a: 5 }, { a: { deep: 1 } })).toEqual({ a: { deep: 1 } });
    });

    test('arrays are replaced wholesale, not merged by index', () => {
        expect(mergeImported({ items: ['a', 'b', 'c'] }, { items: ['x'] })).toEqual({
            items: ['x']
        });
    });

    test('does not mutate either input', () => {
        const base = { help: { en: 'imported', fr: 'aide' } };
        const local = { help: { en: 'overridden' } };
        mergeImported(base, local);
        expect(base).toEqual({ help: { en: 'imported', fr: 'aide' } });
        expect(local).toEqual({ help: { en: 'overridden' } });
    });
});

describe('resolve', () => {
    // Reset expandTemplates to a passthrough default before each test: the
    // runtime model is the resolved tree, mirroring the real expander's behavior
    // for a tree with nothing to expand. A test exercising the wiring overrides
    // this with .mockReturnValueOnce().
    beforeEach(() => {
        expandTemplates.mockReset();
        expandTemplates.mockImplementation((data) => ({ data, diagnostics: [], valid: true }));
    });

    // in-memory transport: map absolute URL href -> raw descriptor text
    const transport = (files) => (url) => {
        const raw = files.get(url.href);
        if (raw === undefined) return Promise.reject(new Error(`no fixture for ${url.href}`));
        return Promise.resolve(raw);
    };

    // a jest.fn() spy for the engine's validate(): it records every call and,
    // like the real validateData on success, echoes the data straight back
    // (resolve descends `before.data`). A test queues specific outcomes with
    // .mockReturnValueOnce() / .mockImplementationOnce().
    const spyValidate = () => jest.fn((schemaName, data) => ({ valid: true, diagnostics: [], data }));

    // name the positional args of the i-th recorded validate() call — most
    // importantly the source map (real vs null) each pass was handed
    const callArgs = (validate, i) => {
        const [schemaName, data, sourceMap] = validate.mock.calls[i];
        return { schemaName, data, sourceMap };
    };

    test('a descriptor with no import is validated as-authored against real lines', async () => {
        const url = new URL('file:///models/param.example.yaml');
        const load = transport(new Map([[url.href, 'type: INT32\nvalue:\n  int32_value: 7\n']]));
        const validate = spyValidate();

        const result = await resolve(url, { validate, load });

        expect(result.valid).toBe(true);
        expect(result.data).toEqual({ type: 'INT32', value: { int32_value: 7 } });
        // no import was inlined, so there is no provenance to record
        expect(result.imports).toEqual([]);
        // and the root has no dependency-graph edges
        expect(result.dependencies).toEqual([]);
        // schema derived from filename, and a real source map (resolves lines)
        // gate pass on the fragment, then the report pass on the resolved tree;
        // with no distinct validateFinal supplied, the same spy sees both
        expect(validate).toHaveBeenCalledTimes(2);
        expect(callArgs(validate, 0).schemaName).toBe('param');
        expect(callArgs(validate, 0).sourceMap.linesFor('/type')).toEqual({ start: 1, end: 1 });
        // the report pass runs against the root's line map too
        expect(callArgs(validate, 1).sourceMap.linesFor('/type')).toEqual({ start: 1, end: 1 });
    });

    test('resolves a root import: target is the base, local overrides win, import dropped', async () => {
        const rootUrl = new URL('file:///models/param.import.yaml');
        const root = [
            'type: INT32',
            'import:',
            '  url: ./param.target.yaml',
            'value:',
            '  int32_value: 42',
            'help:',
            '  en: local',
            ''
        ].join('\n');
        const target = [
            'read_only: true',
            'type: INT32',
            'value:',
            '  int32_value: 0',
            'help:',
            '  en: imported',
            '  fr: aide',
            ''
        ].join('\n');
        const load = transport(new Map([
            [rootUrl.href, root],
            ['file:///models/param.target.yaml', target]
        ]));
        const validate = spyValidate();

        const result = await resolve(rootUrl, { validate, load });

        expect(result.valid).toBe(true);
        expect(result.data).toEqual({
            read_only: true,                   // import-only field survives the merge
            type: 'INT32',
            value: { int32_value: 42 },       // local scalar-ish subtree wins
            help: { en: 'local', fr: 'aide' }  // maps merge; import-only fr survives
        });
        expect(result.data).not.toHaveProperty('import');

        // the inlined file is recorded as provenance; the digest is the sha256
        // of the bytes actually loaded, computed even when the import is unpinned
        expect(result.imports).toEqual([
            { url: 'file:///models/param.target.yaml', digest: crypto.createHash('sha256').update(target).digest('base64'), dependencies: [] }
        ]);
        // the root imports the target directly: one dependency-graph edge
        expect(result.dependencies).toEqual(['file:///models/param.target.yaml']);

        // three passes: the root as authored (its import stub is a valid param,
        // real lines), the imported file on its own (real lines), then the
        // merged tree as a whole (no line info)
        expect(validate).toHaveBeenCalledTimes(3);
        const before = callArgs(validate, 0);
        expect(before.schemaName).toBe('param');
        expect(before.data).toHaveProperty('import');
        expect(before.sourceMap.linesFor('/value/int32_value')).toEqual({ start: 5, end: 5 });
        const imported = callArgs(validate, 1);
        expect(imported.schemaName).toBe('param');
        expect(imported.sourceMap.linesFor('/read_only')).toEqual({ start: 1, end: 1 });
        const merged = callArgs(validate, 2);
        expect(merged.schemaName).toBe('param');
        expect(merged.data).toBe(result.data);
        expect(merged.sourceMap.linesFor('/oid')).toBeNull();
    });

    test('each file is validated against its own declared type (command shares the param shape)', async () => {
        // a command root importing a command target: every pass must use the
        // 'command' schema, derived from the filenames, not a hardcoded 'param'
        const rootUrl = new URL('file:///models/command.import.yaml');
        const load = transport(new Map([
            [rootUrl.href, 'import:\n  url: ./command.target.yaml\nresponse: true\n'],
            ['file:///models/command.target.yaml', 'type: STRING\nvalue:\n  string_value: go\nresponse: true\n']
        ]));
        const validate = spyValidate();

        await resolve(rootUrl, { validate, load });

        expect(validate).toHaveBeenCalledTimes(3);
        expect(validate.mock.calls.map(([schemaName]) => schemaName))
            .toEqual(['command', 'command', 'command']); // root, imported target, merged
    });

    test('an import target invalid on its own gates the merge and reports its diagnostics', async () => {
        const rootUrl = new URL('file:///models/param.import.yaml');
        const load = transport(new Map([
            [rootUrl.href, 'type: INT32\nimport:\n  url: ./param.target.yaml\nvalue:\n  int32_value: 42\n'],
            ['file:///models/param.target.yaml', 'type: NONSENSE\n']
        ]));
        const importDiag = { level: 'error', message: 'bad', instancePath: '/type', lines: { start: 1, end: 1 } };
        const validate = spyValidate();
        validate
            .mockImplementationOnce((schemaName, data) => ({ valid: true, diagnostics: [], data })) // root, as authored
            .mockReturnValueOnce({ valid: false, diagnostics: [importDiag], data: {} });             // imported target

        const result = await resolve(rootUrl, { validate, load });

        expect(result.valid).toBe(false);
        expect(result.diagnostics).toEqual([importDiag]);
        // root and target are each validated (real lines); the final merged pass
        // is skipped because a fragment already failed — no line-less repeats
        expect(validate).toHaveBeenCalledTimes(2);
        // the invalid target contributes nothing: only the local overrides survive
        expect(result.data).toEqual({ type: 'INT32', value: { int32_value: 42 } });
    });

    test('a file invalid as authored stops before resolving its imports', async () => {
        const rootUrl = new URL('file:///models/param.broken.yaml');
        const loaded = [];
        const load = (url) => {
            loaded.push(url.href);
            // an import directive missing its required `url`: descending would
            // dereference directive.url === undefined and fetch a garbage path
            return Promise.resolve('import:\n  digest: abc123\n');
        };
        const badDiag = {
            level: 'error', message: "must have required property 'url'",
            instancePath: '/import', lines: { start: 1, end: 2 }
        };
        const validate = spyValidate();
        validate.mockReturnValueOnce({ valid: false, diagnostics: [badDiag], data: {} });

        const result = await resolve(rootUrl, { validate, load });

        expect(result.valid).toBe(false);
        expect(result.diagnostics).toEqual([badDiag]);
        // validated once, as authored; the malformed import is never fetched and
        // there is no merged "after" pass
        expect(validate).toHaveBeenCalledTimes(1);
        expect(loaded).toEqual([rootUrl.href]);
    });

    test('verifies a matching import digest against the fetched bytes', async () => {
        const rootUrl = new URL('file:///models/param.root.yaml');
        const targetText = 'type: INT32\nvalue:\n  int32_value: 7\n';
        // the digest travels in the file as base64, exactly as the spec stores it
        const digest = crypto.createHash('sha256').update(targetText).digest('base64');
        const rootText = `type: INT32\nimport:\n  url: ./param.target.yaml\n  digest: ${digest}\n`;
        const load = transport(new Map([
            [rootUrl.href, rootText],
            ['file:///models/param.target.yaml', targetText]
        ]));
        const validate = spyValidate();

        const result = await resolve(rootUrl, { validate, load });

        expect(result.valid).toBe(true);
        expect(result.data).toEqual({ type: 'INT32', value: { int32_value: 7 } });
        // provenance carries the digest computed over the bytes loaded, which here
        // matches the declared one exactly
        expect(result.imports).toEqual([
            { url: 'file:///models/param.target.yaml', digest, dependencies: [] }
        ]);
        // the result also reports the root file's own computed digest
        expect(result.digest).toBe(crypto.createHash('sha256').update(rootText).digest('base64'));
    });

    test('pins the root descriptor against a supplied digest', async () => {
        const rootUrl = new URL('file:///models/param.root.yaml');
        const rootText = 'type: INT32\nvalue:\n  int32_value: 7\n';
        const digest = crypto.createHash('sha256').update(rootText).digest('base64');
        const load = transport(new Map([[rootUrl.href, rootText]]));
        const validate = spyValidate();

        const result = await resolve(rootUrl, { validate, load, digest });

        expect(result.valid).toBe(true);
        expect(result.data).toEqual({ type: 'INT32', value: { int32_value: 7 } });
    });

    test('a root digest mismatch rejects rather than resolving', async () => {
        const rootUrl = new URL('file:///models/param.root.yaml');
        const load = transport(new Map([[rootUrl.href, 'type: INT32\nvalue:\n  int32_value: 7\n']]));
        const validate = spyValidate();
        // a well-formed sha256 (32 zero bytes) that is not the root's hash; the
        // root has no importing file to blame, so the failure propagates
        const digest = Buffer.alloc(32).toString('base64');

        await expect(resolve(rootUrl, { validate, load, digest })).rejects.toThrow('Digest mismatch');
    });

    test('a mismatched import digest is reported as a located error, not a throw', async () => {
        const rootUrl = new URL('file:///models/param.root.yaml');
        // a well-formed sha256 digest (32 zero bytes) that isn't the target's
        const wrongDigest = Buffer.alloc(32).toString('base64');
        const load = transport(new Map([
            [rootUrl.href, `type: INT32\nimport:\n  url: ./param.target.yaml\n  digest: ${wrongDigest}\n`],
            ['file:///models/param.target.yaml', 'type: INT32\nvalue:\n  int32_value: 7\n']
        ]));
        const validate = spyValidate();

        const result = await resolve(rootUrl, { validate, load });

        expect(result.valid).toBe(false);
        expect(result.data).toEqual({});
        expect(result.diagnostics).toHaveLength(1);
        const [diag] = result.diagnostics;
        expect(diag.level).toBe('error');
        expect(diag.message).toMatch(/Digest mismatch/);
        // blame the import block in the importing file, with its real lines
        expect(diag.instancePath).toBe('/import');
        expect(diag.lines).toEqual({ start: 3, end: 5 });
        // only the root is validated; the unmaterialized target never is, and the
        // merged "after" pass is skipped once a fragment fails
        expect(validate).toHaveBeenCalledTimes(1);
    });

    test('an import whose file cannot be found is a located error at the nested import', async () => {
        const rootUrl = new URL('file:///models/device.testing.yaml');
        const device = [
            'slot: 0',
            'params:',
            '  gain:',
            '    import:',
            '      url: ./missing.yaml',
            ''
        ].join('\n');
        const load = transport(new Map([[rootUrl.href, device]])); // target absent
        const validate = spyValidate();

        const result = await resolve(rootUrl, { validate, load });

        expect(result.valid).toBe(false);
        expect(result.diagnostics).toHaveLength(1);
        const [diag] = result.diagnostics;
        expect(diag.level).toBe('error');
        // the pointer is threaded through the descent to the nested param's import
        expect(diag.instancePath).toBe('/params/gain/import');
        expect(diag.lines).toEqual({ start: 5, end: 6 });
        // a file that could not be materialized contributes no provenance
        expect(result.imports).toEqual([]);
        // and no dependency-graph edge, since nothing was inlined
        expect(result.dependencies).toEqual([]);
    });

    test('a malformed import digest propagates rather than being recast as a load failure', async () => {
        // 'AAAA' decodes to 3 bytes, not a sha256, so the digest comparison
        // throws when it decodes it; the resolver recasts only genuine load
        // failures, so a bad digest *string* — a content problem the checks
        // will own — propagates.
        const rootUrl = new URL('file:///models/param.root.yaml');
        const load = transport(new Map([
            [rootUrl.href, 'type: INT32\nimport:\n  url: ./param.target.yaml\n  digest: AAAA\n'],
            ['file:///models/param.target.yaml', 'type: INT32\n']
        ]));
        const validate = spyValidate();

        await expect(resolve(rootUrl, { validate, load })).rejects.toThrow('Invalid digest');
    });

    test('a file that imports itself is caught as a cycle, not followed', async () => {
        const url = new URL('file:///models/param.self.yaml');
        const load = transport(new Map([
            [url.href, 'type: INT32\nimport:\n  url: ./param.self.yaml\n']
        ]));
        const validate = spyValidate();

        const result = await resolve(url, { validate, load });

        expect(result.valid).toBe(false);
        expect(result.diagnostics).toHaveLength(1);
        const [diag] = result.diagnostics;
        expect(diag.level).toBe('error');
        expect(diag.message).toMatch(/cycle/i);
        expect(diag.instancePath).toBe('/import');
        expect(diag.lines).toEqual({ start: 3, end: 4 });
        // the file is loaded once; the cycle is caught before re-fetching it
        expect(validate).toHaveBeenCalledTimes(1);
    });

    test('an indirect cycle (a -> b -> a) is caught at the import that closes it', async () => {
        const aUrl = new URL('file:///models/param.a.yaml');
        const load = transport(new Map([
            [aUrl.href, 'type: INT32\nimport:\n  url: ./param.b.yaml\n'],
            ['file:///models/param.b.yaml', 'type: INT32\nimport:\n  url: ./param.a.yaml\n']
        ]));
        const validate = spyValidate();

        const result = await resolve(aUrl, { validate, load });

        expect(result.valid).toBe(false);
        expect(result.diagnostics).toHaveLength(1);
        const [diag] = result.diagnostics;
        expect(diag.message).toMatch(/cycle/i);
        // the loop closes at b's import of a, so it is blamed in b, naming a
        expect(diag.instancePath).toBe('/import');
        expect(diag.message).toMatch(/param\.a\.yaml/);
        expect(diag.lines).toEqual({ start: 3, end: 4 });
        // a and b are each loaded once; a is not fetched a second time
        expect(validate).toHaveBeenCalledTimes(2);
    });

    test('the same file imported on two sibling branches is a diamond, not a cycle', async () => {
        const rootUrl = new URL('file:///models/device.diamond.yaml');
        const device = [
            'slot: 0',
            'params:',
            '  left:',
            '    import:',
            '      url: ./param.shared.yaml',
            '  right:',
            '    import:',
            '      url: ./param.shared.yaml',
            ''
        ].join('\n');
        const shared = 'type: INT32\nvalue:\n  int32_value: 1\n';
        const load = transport(new Map([
            [rootUrl.href, device],
            ['file:///models/param.shared.yaml', shared]
        ]));
        const validate = spyValidate();

        const result = await resolve(rootUrl, { validate, load });

        // shared is an ancestor of neither branch, so importing it twice is fine
        expect(result.valid).toBe(true);
        expect(result.data).toEqual({
            slot: 0,
            params: {
                left: { type: 'INT32', value: { int32_value: 1 } },
                right: { type: 'INT32', value: { int32_value: 1 } }
            }
        });
        // the shared file is reached along both branches but recorded once
        expect(result.imports).toEqual([
            { url: 'file:///models/param.shared.yaml', digest: crypto.createHash('sha256').update(shared).digest('base64'), dependencies: [] }
        ]);
        // both branches import shared directly, so the root has an edge to it per
        // branch; the SBOM collapses these into one dependency
        expect(result.dependencies).toEqual([
            'file:///models/param.shared.yaml',
            'file:///models/param.shared.yaml'
        ]);
    });

    test('descends nested params and resolves an import on a nested param', async () => {
        const rootUrl = new URL('file:///models/device.testing.yaml');
        const device = [
            'slot: 0',
            'params:',
            '  gain:',
            '    import:',
            '      url: ./param.gain.yaml',
            '  mute:',
            '    type: INT32',
            '    value:',
            '      int32_value: 0',
            ''
        ].join('\n');
        const load = transport(new Map([
            [rootUrl.href, device],
            ['file:///models/param.gain.yaml', 'type: INT32\nvalue:\n  int32_value: 5\n']
        ]));
        const validate = spyValidate();

        const result = await resolve(rootUrl, { validate, load });

        expect(result.valid).toBe(true);
        expect(result.data.params.gain).toEqual({ type: 'INT32', value: { int32_value: 5 } });
        expect(result.data.params.gain).not.toHaveProperty('import');
        expect(result.data.params.mute).toEqual({ type: 'INT32', value: { int32_value: 0 } });

        // device as authored, the imported param on its own, then the report
        // pass on the resolved tree
        expect(validate).toHaveBeenCalledTimes(3);
        expect(callArgs(validate, 0).schemaName).toBe('device');
        const param = callArgs(validate, 1);
        expect(param.schemaName).toBe('param');
        expect(param.sourceMap.linesFor('/type')).toEqual({ start: 1, end: 1 });
        const merged = callArgs(validate, 2);
        expect(merged.schemaName).toBe('device');
        expect(merged.data).toBe(result.data);
        // the report pass runs against the root's line map, so root-authored
        // nodes keep their lines
        expect(merged.sourceMap.linesFor('/slot')).toEqual({ start: 1, end: 1 });
    });

    test('descends the commands map to resolve a nested command import', async () => {
        const rootUrl = new URL('file:///models/device.yaml');
        const device = [
            'slot: 0',
            'commands:',
            '  doIt:',
            '    import:',
            '      url: ./command.doit.yaml',
            '    response: true',
            ''
        ].join('\n');
        const load = transport(new Map([
            [rootUrl.href, device],
            ['file:///models/command.doit.yaml', 'type: STRING\nvalue:\n  string_value: go\nresponse: true\n']
        ]));
        const validate = spyValidate();

        const result = await resolve(rootUrl, { validate, load });

        expect(result.data.commands.doIt).toEqual({
            type: 'STRING', value: { string_value: 'go' }, response: true
        });
        expect(result.data.commands.doIt).not.toHaveProperty('import');
        expect(validate).toHaveBeenCalledTimes(3);
        expect(validate.mock.calls.map(([schemaName]) => schemaName))
            .toEqual(['device', 'command', 'device']); // root, imported target's type, merged
    });

    test('resolves a chain of imports (a imports b imports c), merging across all three', async () => {
        const rootUrl = new URL('file:///models/param.a.yaml');
        const bText = 'import:\n  url: ./param.c.yaml\ntype: INT32\n';
        const cText = 'type: INT32\nvalue:\n  int32_value: 7\nhelp:\n  en: c\n  fr: cfr\n';
        const load = transport(new Map([
            [rootUrl.href, 'import:\n  url: ./param.b.yaml\nhelp:\n  en: a\n'],
            ['file:///models/param.b.yaml', bText],
            ['file:///models/param.c.yaml', cText]
        ]));
        const validate = spyValidate();

        const result = await resolve(rootUrl, { validate, load });

        expect(result.valid).toBe(true);
        expect(result.data).toEqual({
            type: 'INT32',                       // from b
            value: { int32_value: 7 },           // from c
            help: { en: 'a', fr: 'cfr' }         // a overrides c's en; c's fr survives
        });
        expect(result.data).not.toHaveProperty('import');

        // provenance lists every inlined file in DFS order: b (imported by a),
        // then c (imported by b); a itself is the root, never an import. Each
        // record carries its own direct edges: b imports c, c imports nothing.
        expect(result.imports).toEqual([
            { url: 'file:///models/param.b.yaml', digest: crypto.createHash('sha256').update(bText).digest('base64'), dependencies: ['file:///models/param.c.yaml'] },
            { url: 'file:///models/param.c.yaml', digest: crypto.createHash('sha256').update(cText).digest('base64'), dependencies: [] }
        ]);
        // the root imports only b directly
        expect(result.dependencies).toEqual(['file:///models/param.b.yaml']);

        // each of the three files validated as authored, then the merged tree
        expect(validate).toHaveBeenCalledTimes(4);
        expect(validate.mock.calls.map(([schemaName]) => schemaName)).toEqual(['param', 'param', 'param', 'param']);
        const merged = callArgs(validate, 3);
        expect(merged.data).toBe(result.data);
        expect(merged.sourceMap.linesFor('/type')).toBeNull();
    });

    test('a relative import url resolves against the importing file', async () => {
        const rootUrl = new URL('file:///models/nested/param.import.yaml');
        const seen = [];
        const load = (url) => {
            seen.push(url.href);
            if (url.href === rootUrl.href) return Promise.resolve('import:\n  url: ../shared/param.target.yaml\n');
            return Promise.resolve('type: INT32\n');
        };
        const validate = spyValidate();

        await resolve(rootUrl, { validate, load });

        // ../shared/param.target.yaml resolved relative to /models/nested/
        expect(seen).toContain('file:///models/shared/param.target.yaml');
    });

    test('a resolved tree that fails the report pass is reported invalid', async () => {
        const rootUrl = new URL('file:///models/param.import.yaml');
        const load = transport(new Map([
            [rootUrl.href, 'type: INT32\nimport:\n  url: ./param.target.yaml\nvalue:\n  int32_value: 42\n'],
            ['file:///models/param.target.yaml', 'type: INT32\nvalue:\n  int32_value: 0\n']
        ]));
        const reportDiag = { level: 'error', message: 'merged conflict', instancePath: '', lines: null };
        const validate = spyValidate();
        const validateFinal = spyValidate().mockReturnValueOnce({ valid: false, diagnostics: [reportDiag], data: {} });             // report pass

        const result = await resolve(rootUrl, { validate, validateFinal, load });

        expect(result.valid).toBe(false);
        expect(result.diagnostics).toContainEqual(reportDiag);
        // expansion runs before the report pass; the resolved (passthrough-expanded)
        // tree is what gets returned
        expect(result.data).toEqual({ type: 'INT32', value: { int32_value: 42 } });
        expect(expandTemplates).toHaveBeenCalledTimes(1);
        expect(validate).toHaveBeenCalledTimes(2);
        expect(validateFinal).toHaveBeenCalledTimes(1);
    });

    test('expands the resolved tree, threading the expander output into the result', async () => {
        const rootUrl = new URL('file:///models/device.templated.yaml');
        const device = [
            'slot: 0',
            'params:',
            '  faders:',
            '    type: FLOAT32_ARRAY',
            ''
        ].join('\n');
        const load = transport(new Map([[rootUrl.href, device]]));
        const validate = spyValidate();
        // the expander's structural behavior lives in tests/templates.test.js; here
        // it is a spy returning a canned model to prove resolve threads it through
        const expansion = {
            data: { params: { faders: { type: 'FLOAT32_ARRAY' } } },
            diagnostics: [],
            valid: true
        };
        expandTemplates.mockReturnValueOnce(expansion);

        const result = await resolve(rootUrl, { validate, load });

        expect(result.valid).toBe(true);
        // resolve hands the expander the resolved tree
        expect(expandTemplates).toHaveBeenCalledTimes(1);
        expect(expandTemplates).toHaveBeenCalledWith(expect.objectContaining({ slot: 0 }));
        // and threads the expander's data straight into the result
        expect(result.data).toBe(expansion.data);
    });

    test('skips expansion when disableTemplateExpansion is set', async () => {
        const rootUrl = new URL('file:///models/param.templated.yaml');
        const load = transport(new Map([
            [rootUrl.href, 'type: INT32\ntemplate_oid: lib/base\n']
        ]));
        const validate = spyValidate();

        const result = await resolve(rootUrl, { validate, load, disableTemplateExpansion: true });

        expect(result.valid).toBe(true);
        expect(expandTemplates).not.toHaveBeenCalled();
        // the merged tree is returned with its template_oid left as authored
        expect(result.data).toEqual({ type: 'INT32', template_oid: 'lib/base' });
    });

    test('a template error marks the result invalid and returns the pre-expansion tree', async () => {
        const rootUrl = new URL('file:///models/device.templated.yaml');
        const device = [
            'params:',
            '  faders:',
            '    type: FLOAT32_ARRAY',
            '    template_oid: lib/missing',
            ''
        ].join('\n');
        const load = transport(new Map([[rootUrl.href, device]]));
        const validate = spyValidate();
        const diag = { level: 'error', message: 'template lib/missing does not resolve', instancePath: '/params/faders/template_oid', lines: null };
        // an expansion that fails must not leak its half-built data into the result
        expandTemplates.mockReturnValueOnce({ data: { bogus: true }, diagnostics: [diag], valid: false });

        const result = await resolve(rootUrl, { validate, load });

        expect(result.valid).toBe(false);
        expect(result.diagnostics).toContainEqual(diag);
        // the pre-expansion tree is handed back, not the expander's own data
        expect(result.data).toEqual({ params: { faders: { type: 'FLOAT32_ARRAY', template_oid: 'lib/missing' } } });
    });
});

