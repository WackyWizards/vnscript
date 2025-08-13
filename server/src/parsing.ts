import { Diagnostic } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { validateScript } from './validation';

export function parseText(
  text: string,
  textDocument: TextDocument,
  diagnostics: Diagnostic[]
) {
  validateScript(text, textDocument, diagnostics);
}
