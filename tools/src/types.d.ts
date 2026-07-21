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

/** Flags to disable individual post-schema checks. */
export interface CheckOptions {
    /** override the schema name derived from the filename */
    schemaName?: string;
    disableMandatoryParams?: boolean;
    disableNestedValueChecks?: boolean;
    disableScopeChecks?: boolean;
}

/** Options accepted by the functional `validate` entry point. */
export interface ValidateOptions extends CheckOptions {
    /** sha256 digest to verify the input against */
    digest?: string;
}

/** Validate a descriptor from a path or URL against the ST 2138-a schema. */
export function validate(
    input: string | URL,
    options?: ValidateOptions,
): Promise<ValidationResult>;

/** Format a single diagnostic as a human-readable line. */
export function formatDiagnostic(diagnostic: Diagnostic): string;

/** Print an array of diagnostics, one formatted line each, via console.log. */
export function printDiagnostics(diagnostics: Diagnostic[]): void;
