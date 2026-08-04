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


/**
 * Severity level of a diagnostic. Mirrors the WARNING/ERROR string constants
 * in checks/constants.js (`'warning'` / `'error'`).
 */
export type Level = 'warning' | 'error';

/** A structured validation finding, with source line info where available. */
export interface Diagnostic {
    /** severity, one of the ERROR/WARNING constants from checks/constants */
    level: Level;
    /** human-readable description */
    message: string;
    /** JSON pointer to the offending node */
    instancePath: string;
    /** source line range, or null if unknown */
    lines: { start: number; end: number } | null;
}

/** Result of validating a single descriptor. */
export interface ValidationResult {
    valid: boolean;
    diagnostics: Diagnostic[];
    data: object;
}

/** A file that was inlined during resolution — provenance for an SBOM. */
export interface ImportRecord {
    /** the resolved absolute URL the import was fetched from */
    url: string;
    /** base64-encoded sha256 of the bytes actually loaded for this import */
    digest: string;
}

/** Result of resolving a descriptor's `import` directives into a single tree. */
export interface ResolutionResult {
    /** the merged self-contained descriptor, or `{}` when invalid */
    data: object;
    /** findings gathered during resolution */
    diagnostics: Diagnostic[];
    /** whether resolution produced a valid descriptor */
    valid: boolean;
    /** every file inlined during resolution, deduped by URL */
    imports: ImportRecord[];
    /** base64-encoded sha256 of the bytes loaded for the root descriptor */
    digest: string;
}

/** Flags to disable individual post-schema checks. */
export interface CheckOptions {
    disableMandatoryParams?: boolean;
    disableNestedValueChecks?: boolean;
    disableScopeChecks?: boolean;
}

/**
 * Options common to the descriptor entry points (`validate` and `resolve`): an
 * integrity digest, a custom transport, and the check toggles from
 * {@link CheckOptions}.
 */
export interface DescriptorOptions extends CheckOptions {
    /** base64-encoded sha256 digest to verify the descriptor against (the root file, when resolving) */
    digest?: string;
    /**
     * Custom transport for loading descriptor bytes, in place of the default
     * file/HTTP loader. Receives a resolved URL and returns the raw text;
     * integrity (digest) checks and parsing are still performed by the engine
     * on whatever it returns.
     */
    load?: Loader;
}

/**
 * Options accepted by the functional `validate` entry point. Identical to
 * {@link DescriptorOptions} today, but kept as its own name so the two entry
 * points can diverge without churning callers.
 */
export interface ValidateOptions extends DescriptorOptions {}

/**
 * Options accepted by the functional `resolve` entry point. Identical to
 * {@link DescriptorOptions} today, but kept as its own name so the two entry
 * points can diverge without churning callers. Each file's schema is derived
 * from its own name as the tree is walked.
 */
export interface ResolveOptions extends DescriptorOptions {}

/**
 * Loads the raw text of a descriptor from a resolved URL. Supply a custom
 * implementation to control transport (caching, auth, in-memory fixtures);
 * the engine still verifies and parses the returned bytes. Signal failure by
 * rejecting the returned promise; the resolved value is always the descriptor
 * text.
 */
export type Loader = (url: URL) => Promise<string>;

/** Validate a descriptor from a path or URL against the ST 2138-a schema. */
export function validate(
    input: string | URL,
    options?: ValidateOptions,
): Promise<ValidationResult>;

/** Resolve a descriptor's `import` directives into a single self-contained tree. */
export function resolve(
    input: string | URL,
    options?: ResolveOptions,
): Promise<ResolutionResult>;

/** Render a resolution result's provenance as a CycloneDX 1.6 BOM document. */
export function toCycloneDx(result: ResolutionResult, subject: string | URL): object;

/** Format a single diagnostic as a human-readable line. */
export function formatDiagnostic(diagnostic: Diagnostic): string;

/** Print an array of diagnostics, one formatted line each, via console.log. */
export function printDiagnostics(diagnostics: Diagnostic[]): void;
