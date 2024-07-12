import {
	Diagnostic,
	DiagnosticSeverity,
} from 'vscode-languageserver/node';

import { 
	validateContent, 
	addDiagnostic 
} from "./validation";

import { TextDocument } from "vscode-languageserver-textdocument";

export function parseText(text: string, textDocument: TextDocument, diagnostics: Diagnostic[]) {
    const length = text.length;
    let i = 0;

    while (i < length) {
        if (text[i] === '(') {
            const start = i;
            i++;
            let depth = 1;

            while (i < length && depth > 0) {
                if (text[i] === '(') {
                    depth++;
                } else if (text[i] === ')') {
                    depth--;
                }
                i++;
            }

            if (depth === 0) {
                const content = text.substring(start + 1, i - 1).trim();
                validateContent(content, start, i, textDocument, diagnostics);
            } else {
                addDiagnostic(diagnostics, DiagnosticSeverity.Error, textDocument, { index: start, length: length - start, input: text }, `Unclosed parenthesis.`);
                break;
            }
        } else {
            i++;
        }
    }
}