import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as keywords from '../../keywords.json';

const allowedKeywords = new Set(Object.keys(keywords));
const allowedOperators = new Set(['=', '+', '-', '*', '/', '%']);

interface ParsedKeyword {
  keyword: string;
  args: string[];
}

type Validator = (
  keyword: ParsedKeyword,
  start: number,
  end: number,
  textDocument: TextDocument,
  diagnostics: Diagnostic[],
  labels: string[]
) => void;

interface KeywordSpec {
  minArgs: number;
  maxArgs?: number;
  validator?: Validator;
}

// ---- Keyword Spec ----
const KEYWORDS: Record<string, KeywordSpec> = {
  label: { minArgs: 1, validator: validateLabel },
  dialogue: { minArgs: 1, maxArgs: 3, validator: validateDialogue },
  choice: { minArgs: 1 },
  say: { minArgs: 1, maxArgs: 1 },
  sound: { minArgs: 1, maxArgs: 1 },
  bg: { minArgs: 1, maxArgs: 1 },
  char: { minArgs: 1, maxArgs: 3 },
  after: { minArgs: 1, validator: validateAfter },
  jump: { minArgs: 1, maxArgs: 1, validator: validateJump },
  start: { minArgs: 1, maxArgs: 1, validator: validateStart },
  set: { minArgs: 2, validator: validateSet },
  end: { minArgs: 0, maxArgs: 0 },
  exp: { minArgs: 1, maxArgs: 1 },
};

// Utility to push diagnostics
export function addDiagnostic(
  diagnostics: Diagnostic[],
  severity: DiagnosticSeverity,
  document: TextDocument,
  start: number,
  end: number,
  message: string
) {
  if (
    diagnostics.some(
      (d) =>
        d.range.start.character === document.positionAt(start).character &&
        d.range.start.line === document.positionAt(start).line &&
        d.message === message
    )
  ) {
    return; // prevent duplicates
  }

  diagnostics.push({
    severity,
    range: { start: document.positionAt(start), end: document.positionAt(end) },
    message,
    source: 'vnscript',
  });
}

// Tokenize
function parseKeyword(content: string): ParsedKeyword | null {
  const parts = content.match(/"[^"]*"|\S+/g)?.map((p) => p.trim()) || [];
  return parts.length ? { keyword: parts[0], args: parts.slice(1) } : null;
}

// ---- Validators ----
function validateJump(
  keyword: ParsedKeyword,
  start: number,
  end: number,
  document: TextDocument,
  diagnostics: Diagnostic[],
  labels: string[]
) {
  if (keyword.args[0] !== 'end' && !labels.includes(keyword.args[0])) {
    addDiagnostic(
      diagnostics,
      DiagnosticSeverity.Error,
      document,
      start,
      end,
      `Jump references undefined label '${keyword.args[0]}'`
    );
  }
}

function validateStart(
  keyword: ParsedKeyword,
  start: number,
  end: number,
  document: TextDocument,
  diagnostics: Diagnostic[],
  labels: string[]
) {
  if (!labels.includes(keyword.args[0])) {
    addDiagnostic(
      diagnostics,
      DiagnosticSeverity.Error,
      document,
      start,
      end,
      `Start references undefined label '${keyword.args[0]}'`
    );
  }
}

function validateSet(
  keyword: ParsedKeyword,
  start: number,
  end: number,
  document: TextDocument,
  diagnostics: Diagnostic[]
) {
  if (!/^[a-zA-Z_][\w-]*$/.test(keyword.args[0])) {
    addDiagnostic(
      diagnostics,
      DiagnosticSeverity.Error,
      document,
      start,
      end,
      `Invalid variable name '${keyword.args[0]}'`
    );
  }
}

function validateDialogue(
  keyword: ParsedKeyword,
  start: number,
  end: number,
  document: TextDocument,
  diagnostics: Diagnostic[]
) {
  const [textArg, speakerKeyword, speaker] = keyword.args;
  if (!/^".*"$/.test(textArg || '')) {
    return addDiagnostic(
      diagnostics,
      DiagnosticSeverity.Error,
      document,
      start,
      end,
      'Dialogue must be enclosed in double quotes'
    );
  }
  if (textArg.slice(1, -1).trim() === '') {
    addDiagnostic(
      diagnostics,
      DiagnosticSeverity.Warning,
      document,
      start,
      end,
      'Empty dialogue'
    );
  }
  if (keyword.args.length === 3 && speakerKeyword !== 'speaker') {
    addDiagnostic(
      diagnostics,
      DiagnosticSeverity.Error,
      document,
      start,
      end,
      'Dialogue with 3 args should use: (dialogue "dialogue" speaker Character)'
    );
  }
  if (keyword.args.length === 3 && !speaker?.trim()) {
    addDiagnostic(
      diagnostics,
      DiagnosticSeverity.Error,
      document,
      start,
      end,
      'Speaker name is required when using "say"'
    );
  }
}

function validateLabel(
  keyword: ParsedKeyword,
  start: number,
  end: number,
  document: TextDocument,
  diagnostics: Diagnostic[],
  labels: string[]
) {
  const name = keyword.args[0];
  if (labels.filter((l) => l === name).length > 1) {
    addDiagnostic(
      diagnostics,
      DiagnosticSeverity.Error,
      document,
      start,
      end,
      `Duplicate label '${name}'`
    );
  }
  if (!/^[a-zA-Z][\w-]*$/.test(name)) {
    addDiagnostic(
      diagnostics,
      DiagnosticSeverity.Warning,
      document,
      start,
      end,
      'Invalid label name'
    );
  }
}

/**
 * Extract all label names.
 * @param text Text to extract labels from.
 * @returns Array of label names.
 */
export function extractLabels(text: string): string[] {
  return [...text.matchAll(/\(label\s+([^\s)]+)/g)].map((m) => m[1]);
}

function validateAfter(
  keyword: ParsedKeyword,
  start: number,
  end: number,
  document: TextDocument,
  diagnostics: Diagnostic[]
) {
  const valid = ['load', 'jump', 'end', '(set'];
  if (!valid.includes(keyword.args[0])) {
    addDiagnostic(
      diagnostics,
      DiagnosticSeverity.Error,
      document,
      start,
      end,
      `Unknown after action '${keyword.args[0]}'`
    );
  }
}

export function validateScript(
  text: string,
  document: TextDocument,
  diagnostics: Diagnostic[]
) {
  // Balanced parentheses check (moved from parsing.ts)
  const open = (text.match(/\(/g) || []).length;
  const close = (text.match(/\)/g) || []).length;
  if (open !== close) {
    addDiagnostic(
      diagnostics,
      DiagnosticSeverity.Error,
      document,
      0,
      1,
      `Mismatched parentheses: ${open} opening, ${close} closing`
    );
  }

  // Extract labels
  const labels = extractLabels(text);

  // Validate structure recursively
  parseAndValidate(text, 0, document, diagnostics, labels);

  // Extra start keyword rules (moved from parsing.ts)
  const starts = [...text.matchAll(/\(start\s+/g)];
  if (starts.length === 0) {
    addDiagnostic(
      diagnostics,
      DiagnosticSeverity.Error,
      document,
      0,
      1,
      'Script must contain a start'
    );
  } else if (starts.length > 1) {
    addDiagnostic(
      diagnostics,
      DiagnosticSeverity.Error,
      document,
      starts[1].index!,
      starts[1].index! + 10,
      'Multiple start keywords found'
    );
  }

  // Extra dialogue quoting check
  for (const m of text.matchAll(/\(dialogue\s+([^")]+)/g)) {
    addDiagnostic(
      diagnostics,
      DiagnosticSeverity.Error,
      document,
      m.index!,
      m.index! + m[0].length,
      'Dialogue must be enclosed in double quotes'
    );
  }
}

// Recursive parse + validate
export function parseAndValidate(
  text: string,
  offset: number,
  document: TextDocument,
  diagnostics: Diagnostic[],
  labels: string[]
) {
  const stack: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') {
      stack.push(i);
    } else if (text[i] === ')') {
      const start = stack.pop();
      if (start !== undefined) {
        const absStart = offset + start;
        const absEnd = offset + i + 1;
        const content = text.slice(start + 1, i).trim();

        const parsed = parseKeyword(content);
        if (!parsed) continue;

        // Unknown keyword
        if (
          !allowedKeywords.has(parsed.keyword) &&
          !allowedOperators.has(parsed.keyword)
        ) {
          addDiagnostic(
            diagnostics,
            DiagnosticSeverity.Error,
            document,
            absStart,
            absEnd,
            `Unknown keyword '${parsed.keyword}'`
          );
        }

        // Keyword-specific validation
        const spec = KEYWORDS[parsed.keyword];
        if (spec) {
          if (parsed.args.length < spec.minArgs) {
            addDiagnostic(
              diagnostics,
              DiagnosticSeverity.Error,
              document,
              absStart,
              absEnd,
              `Too few args for '${parsed.keyword}'`
            );
          }
          if (spec.maxArgs && parsed.args.length > spec.maxArgs) {
            addDiagnostic(
              diagnostics,
              DiagnosticSeverity.Warning,
              document,
              absStart,
              absEnd,
              `Too many args for '${parsed.keyword}'`
            );
          }
          spec.validator?.(
            parsed,
            absStart,
            absEnd,
            document,
            diagnostics,
            labels
          );
        }

        // Recurse into nested content
        parseAndValidate(content, absStart + 1, document, diagnostics, labels);
      }
    }
  }
}
