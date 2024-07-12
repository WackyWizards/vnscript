import {
	Diagnostic,
	DiagnosticSeverity,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

export function validateContent(content: string, start: number, end: number, textDocument: TextDocument, diagnostics: Diagnostic[]) {
    if (content.startsWith('label')) 
	{
        validateLabel(content, start, end, textDocument, diagnostics);
    } 
	else if (content.startsWith('start-dialogue')) 
	{
        validateStartDialogue(content, start, end, textDocument, diagnostics);
    }
    else if (content.startsWith('set'))
    {
        validateVariables(content, start, end, textDocument, diagnostics);
    }
	else 
	{
        addDiagnostic(diagnostics, DiagnosticSeverity.Error, textDocument, { index: start, length: end - start, input: content }, `Unexpected content.`);
    }
}

export function validateLabel(content: string, start: number, end: number, textDocument: TextDocument, diagnostics: Diagnostic[]) {
    const labelContent = content.slice(6).trim();
    if (!labelContent) {
        addDiagnostic(diagnostics, DiagnosticSeverity.Error, textDocument, { index: start, length: end - start, input: content }, `Empty label.`);
        return;
    }

    if (labelContent.includes('(label ')) {
        addDiagnostic(diagnostics, DiagnosticSeverity.Error, textDocument, { index: start, length: end - start, input: content }, `Why?`);
    }

    if (!labelContent.includes('(text ')) {
        addDiagnostic(diagnostics, DiagnosticSeverity.Error, textDocument, { index: start, length: end - start, input: content }, `Label should include '(text "")' content.`);
    }

    const bgMatches = [...labelContent.matchAll(/\(bg\s+([^\s]+)\)/g)];
    if (bgMatches.length > 1) {
        addDiagnostic(diagnostics, DiagnosticSeverity.Error, textDocument, { index: start, length: end - start, input: content }, `There can only be one 'bg' keyword in a label.`);
    }

    for (const bgMatch of bgMatches) {
        const bgMatchIndex = bgMatch.index ?? 0;
        if (!bgMatch[1].includes('.')) {
            addDiagnostic(diagnostics, DiagnosticSeverity.Error, textDocument, { index: start + bgMatchIndex, length: bgMatch[0].length, input: content }, `'bg' keyword needs to feature the file extension.`);
        }
    }
}

export function validateStartDialogue(content: string, start: number, end: number, textDocument: TextDocument, diagnostics: Diagnostic[]) {
    const dialogueName = content.slice(14).trim();
    if (!dialogueName) {
        addDiagnostic(diagnostics, DiagnosticSeverity.Error, textDocument, { index: start, length: end - start, input: content }, `Start-dialogue needs to point to a label.`);
    }

    const labelPattern = new RegExp(`\\(label\\s+${dialogueName}\\s`, 'g');
    if (!labelPattern.test(textDocument.getText())) {
        addDiagnostic(diagnostics, DiagnosticSeverity.Error, textDocument, { index: start, length: end - start, input: content }, `No label found with the name '${dialogueName}'.`);
    }
}

export function validateVariables(content: string, start: number, end: number, textDocument: TextDocument, diagnostics: Diagnostic[]) {
    // @TODO: Add variable validation.
}

export function addDiagnostic(diagnostics: Diagnostic[], severity: DiagnosticSeverity, textDocument: TextDocument, match: { index: number; length: number; input: string }, message: string) {
    const diagnostic: Diagnostic = {
        severity: severity,
        range: {
            start: textDocument.positionAt(match.index),
            end: textDocument.positionAt(match.index + match.length),
        },
        message: message,
        source: 'ex',
    };
    diagnostics.push(diagnostic);
}