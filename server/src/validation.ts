import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Keywords } from '../../shared/out/keywords';

const Builtins = new Set(Object.keys(Keywords));

const Operators = new Set([
  '+',
  '-',
  '*',
  '/',
  '=',
  '!=',
  '>',
  '<',
  '>=',
  '<=',
]);

// Constants that look like builtins but cannot be called as functions
const NonCallable = new Set(['true', 'false']);

// Valid identifier patterns
const NamePattern = /^[a-zA-Z_][\w-]*$/;
const GlobalVarPattern = /^\$[a-zA-Z_][\w-]*$/;

// Keywords where every argument is an expression/value and should be validated
// as such. All other keywords take names, paths, or sub-keywords as args and
// their atom arguments must NOT be checked against the variable scope.
const ExpressionKeywords = new Set([
  '+',
  '-',
  '*',
  '/',
  '=',
  '!=',
  '>',
  '<',
  '>=',
  '<=',
  'if',
  'when',
  'and',
  'or',
  'not',
  'cond',
  'pow',
  'sqrt',
  'body',
]);

// [min args, max args] not counting the keyword itself. Infinity = no upper limit.
const Arity: Partial<Record<string, [number, number]>> = {
  label: [1, Infinity],
  dialogue: [1, Infinity],
  choice: [1, Infinity],
  jump: [1, 1],
  after: [1, Infinity],
  speaker: [1, 1],
  sound: [1, Infinity],
  mixer: [1, 1],
  music: [1, Infinity],
  bg: [1, 1],
  input: [1, 1],
  char: [1, Infinity],
  set: [2, Infinity],
  defun: [3, Infinity],
  pow: [2, 2],
  sqrt: [1, 1],
  body: [1, Infinity],
  load: [1, 1],
  start: [1, 1],
  end: [0, 0],
  if: [2, 3],
  when: [2, Infinity],
  and: [1, Infinity],
  or: [1, Infinity],
  not: [1, 1],
  '+': [2, Infinity],
  '-': [2, Infinity],
  '*': [2, Infinity],
  '/': [2, Infinity],
  '=': [2, 2],
  '!=': [2, 2],
  '>': [2, 2],
  '<': [2, 2],
  '>=': [2, 2],
  '<=': [2, 2],
};

interface Token {
  value: string;
  start: number;
  end: number;
}

type Node = ListNode | AtomNode;

interface ListNode {
  type: 'list';
  children: Node[];
  start: number;
  end: number;
}

interface AtomNode {
  type: 'atom';
  value: string;
  kind: 'symbol' | 'string' | 'number';
  start: number;
  end: number;
}

interface Scope {
  functions: Set<string>;
  vars: Set<string>;
  labels: Set<string>;
}

class TokenizeError extends Error {
  constructor(
    message: string,
    public readonly offset: number,
  ) {
    super(message);
  }
}

function isWhitespaceOrComma(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',';
}

function addDiagnostic(
  diagnostics: Diagnostic[],
  document: TextDocument,
  start: number,
  end: number,
  message: string,
  severity = DiagnosticSeverity.Error,
) {
  diagnostics.push({
    severity,
    range: { start: document.positionAt(start), end: document.positionAt(end) },
    message,
    source: 'vnscript',
  });
}

// Validate and register a variable name from set/input.
// Returns 'local', 'global', or 'invalid'.
function validateVarName(
  node: AtomNode,
  diagnostics: Diagnostic[],
  document: TextDocument,
): 'local' | 'global' | 'invalid' {
  if (node.value.startsWith('$')) {
    if (!GlobalVarPattern.test(node.value)) {
      addDiagnostic(
        diagnostics,
        document,
        node.start,
        node.end,
        `Invalid global variable name '${node.value}'`,
      );
      return 'invalid';
    }
    return 'global';
  }

  if (!NamePattern.test(node.value)) {
    addDiagnostic(
      diagnostics,
      document,
      node.start,
      node.end,
      `Invalid variable name '${node.value}'`,
    );
    return 'invalid';
  }

  return 'local';
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    // whitespace, commas are optional visual separators (e.g. in pos lists)
    if (isWhitespaceOrComma(c)) {
      i++;
      continue;
    }

    // single-line comment
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
      continue;
    }

    // block comment, depth-tracked so nested /* ... */ works
    if (c === '/' && text[i + 1] === '*') {
      const commentStart = i;
      i += 2;
      let depth = 1;

      while (i < text.length && depth > 0) {
        if (text[i] === '/' && text[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (text[i] === '*' && text[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }

      if (depth > 0) {
        throw new TokenizeError('Unterminated block comment', commentStart);
      }
      continue;
    }

    // parens
    if (c === '(' || c === ')') {
      tokens.push({ value: c, start: i, end: i + 1 });
      i++;
      continue;
    }

    // strings
    if (c === '"') {
      const stringStart = i;
      let j = i + 1;

      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === '"') {
          break;
        }
        j++;
      }

      if (j >= text.length)
        throw new TokenizeError('Expected closing quote marks for end of string value', stringStart);

      j++;
      tokens.push({ value: text.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }

    // symbols / numbers, stop on whitespace, commas, and parens
    let j = i;
    while (
      j < text.length &&
      !isWhitespaceOrComma(text[j]) &&
      text[j] !== '(' &&
      text[j] !== ')'
    ) {
      j++;
    }

    tokens.push({ value: text.slice(i, j), start: i, end: j });
    i = j;
  }

  return tokens;
}

function parse(tokens: Token[]): Node[] {
  let i = 0;

  function parseExpr(): Node {
    const token = tokens[i];
    if (!token) {
      throw new Error('Unexpected end of file');
    }

    if (token.value === '(') {
      const start = token.start;
      i++;

      const children: Node[] = [];
      while (tokens[i] && tokens[i].value !== ')') {
        children.push(parseExpr());
      }

      const endToken = tokens[i];
      if (!endToken) {
        throw new Error("Unclosed '(', missing ')'");
      }
      i++;

      return { type: 'list', children, start, end: endToken.end };
    }

    if (token.value === ')') {
      throw new Error("Unexpected ')', no matching '('");
    }

    i++;

    let kind: AtomNode['kind'] = 'symbol';
    if (token.value.startsWith('"')) {
      kind = 'string';
    } else if (/^-?\d+(\.\d+)?$/.test(token.value)) {
      kind = 'number';
    }

    return {
      type: 'atom',
      value: token.value,
      kind,
      start: token.start,
      end: token.end,
    };
  }

  const nodes: Node[] = [];
  while (i < tokens.length) nodes.push(parseExpr());
  return nodes;
}

export function validateScript(
  text: string,
  document: TextDocument,
  diagnostics: Diagnostic[],
) {
  let ast: Node[];

  try {
    const tokens = tokenize(text);
    ast = parse(tokens);
  } catch (err) {
    const offset = err instanceof TokenizeError ? err.offset : 0;
    addDiagnostic(
      diagnostics,
      document,
      offset,
      offset + 1,
      err instanceof Error ? err.message : String(err),
    );
    return;
  }

  const scope: Scope = {
    functions: new Set(),
    vars: new Set(),
    labels: new Set(),
  };

  // first pass, collect labels and functions for forward references
  for (const node of ast) {
    if (node.type !== 'list') {
      continue;
    }

    const head = node.children[0];
    if (!head || head.type !== 'atom') {
      continue;
    }

    if (head.value === 'label') {
      const name = node.children[1];
      if (name?.type === 'atom') {
        if (scope.labels.has(name.value)) {
          addDiagnostic(
            diagnostics,
            document,
            name.start,
            name.end,
            `Duplicate label '${name.value}'`,
          );
        }
        scope.labels.add(name.value);
      }
    }

    if (head.value === 'defun') {
      const name = node.children[1];
      if (name?.type === 'atom') {
        if (scope.functions.has(name.value)) {
          addDiagnostic(
            diagnostics,
            document,
            name.start,
            name.end,
            `Duplicate function '${name.value}'`,
          );
        }
        scope.functions.add(name.value);
      }
    }
  }

  for (const node of ast) {
    validateNode(node, scope, diagnostics, document);
  }
}

function validateNode(
  node: Node,
  scope: Scope,
  diagnostics: Diagnostic[],
  document: TextDocument,
) {
  if (node.type !== 'list') {
    return;
  }

  if (node.children.length === 0) {
    addDiagnostic(
      diagnostics,
      document,
      node.start,
      node.end,
      'Empty expression',
    );
    return;
  }

  const head = node.children[0];

  if (head.type !== 'atom') {
    addDiagnostic(
      diagnostics,
      document,
      head.start,
      head.end,
      'Expression head must be a symbol',
    );
    return;
  }

  const name = head.value;

  if (NonCallable.has(name)) {
    addDiagnostic(
      diagnostics,
      document,
      head.start,
      head.end,
      `'${name}' is a constant and cannot be used as a keyword`,
    );
    return;
  }

  const knownCallable =
    Builtins.has(name) || Operators.has(name) || scope.functions.has(name);
  if (!knownCallable) {
    addDiagnostic(
      diagnostics,
      document,
      head.start,
      head.end,
      `Unknown keyword '${name}'`,
    );
  }

  // arity check
  const arity = Arity[name];
  const argCount = node.children.length - 1;

  if (arity) {
    const [min, max] = arity;
    if (argCount < min) {
      addDiagnostic(
        diagnostics,
        document,
        node.start,
        node.end,
        `'${name}' requires at least ${min} argument${min === 1 ? '' : 's'}, got ${argCount}`,
      );
    } else if (argCount > max) {
      const firstExcess = node.children[max + 1];
      addDiagnostic(
        diagnostics,
        document,
        firstExcess.start,
        node.end,
        `'${name}' accepts at most ${max} argument${max === 1 ? '' : 's'}, got ${argCount}`,
      );
    }
  }

  // label, runs in its own scope so vars don't leak
  if (name === 'label') {
    const labelName = node.children[1];
    if (
      !labelName ||
      labelName.type !== 'atom' ||
      labelName.kind !== 'symbol'
    ) {
      addDiagnostic(
        diagnostics,
        document,
        node.start,
        node.end,
        "'label' requires a name as its first argument",
      );
      return;
    }

    const labelScope: Scope = {
      functions: scope.functions,
      labels: scope.labels,
      vars: new Set(scope.vars),
    };
    for (const child of node.children.slice(2)) {
      validateNode(child, labelScope, diagnostics, document);
    }
    return;
  }

  if (name === 'defun') {
    validateDefun(node, scope, diagnostics, document);
    return;
  }

  // set, loop over key-value pairs, validate each assigned value
  if (name === 'set') {
    for (let i = 1; i < node.children.length - 1; i += 2) {
      const varName = node.children[i];
      const value = node.children[i + 1];

      if (varName.type !== 'atom' || varName.kind !== 'symbol') {
        addDiagnostic(
          diagnostics,
          document,
          varName.start,
          varName.end,
          'Variable name must be a symbol',
        );
      } else {
        const kind = validateVarName(varName, diagnostics, document);
        if (kind === 'local') {
          scope.vars.add(varName.value);
        }
      }

      if (value) {
        validateValue(value, scope, diagnostics, document);
      }
    }
    return;
  }

  // input, registers the target variable, no value arg
  if (name === 'input') {
    const varName = node.children[1];
    if (varName) {
      if (varName.type !== 'atom' || varName.kind !== 'symbol') {
        addDiagnostic(
          diagnostics,
          document,
          varName.start,
          varName.end,
          'Variable name must be a symbol',
        );
      } else {
        const kind = validateVarName(varName, diagnostics, document);
        if (kind === 'local') scope.vars.add(varName.value);
      }
    }
    return;
  }

  // jump / start, validate the label target
  if (name === 'jump' || name === 'start') {
    const target = node.children[1];
    if (target?.type === 'atom' && !scope.labels.has(target.value)) {
      addDiagnostic(
        diagnostics,
        document,
        target.start,
        target.end,
        `Unknown label '${target.value}'`,
      );
    }
    return;
  }

  // dialogue, multi-part text (strings, variable refs, expressions),
  // followed by optional 'speaker' keyword pairs
  if (name === 'dialogue') {
    const args = node.children.slice(1);
    const firstKeywordIdx = args.findIndex(
      (a) => a.type === 'atom' && a.kind === 'symbol' && a.value === 'speaker',
    );
    const textArgs =
      firstKeywordIdx === -1 ? args : args.slice(0, firstKeywordIdx);

    if (textArgs.length === 0) {
      addDiagnostic(
        diagnostics,
        document,
        node.start,
        node.end,
        "'dialogue' requires at least one text argument (string, variable, or expression)",
      );
      return;
    }

    for (const part of textArgs) {
      if (part.type === 'list') {
        validateNode(part, scope, diagnostics, document);
      } else if (part.kind === 'symbol') {
        validateValue(part, scope, diagnostics, document);
      }
    }

    const keywordArgs =
      firstKeywordIdx === -1 ? [] : args.slice(firstKeywordIdx);
    for (let i = 0; i < keywordArgs.length; i++) {
      const kw = keywordArgs[i];
      if (kw.type !== 'atom' || kw.kind !== 'symbol') {
        addDiagnostic(
          diagnostics,
          document,
          kw.start,
          kw.end,
          "Expected a keyword (e.g. 'speaker')",
        );
        continue;
      }
      if (kw.value !== 'speaker') {
        addDiagnostic(
          diagnostics,
          document,
          kw.start,
          kw.end,
          `Unknown dialogue keyword '${kw.value}'`,
        );
      }
      i++; // skip the keyword's argument
    }
    return;
  }

  // choice, string label, then optional jump/cond sub-keyword pairs
  if (name === 'choice') {
    const text = node.children[1];
    if (text?.type !== 'atom' || text.kind !== 'string') {
      addDiagnostic(
        diagnostics,
        document,
        node.start,
        node.end,
        "'choice' requires a display string as its first argument",
      );
    }

    for (let i = 2; i < node.children.length; i++) {
      const arg = node.children[i];
      if (arg.type !== 'atom' || arg.kind !== 'symbol') {
        continue;
      }

      if (arg.value !== 'jump' && arg.value !== 'cond') {
        addDiagnostic(
          diagnostics,
          document,
          arg.start,
          arg.end,
          `Unknown choice keyword '${arg.value}', expected: jump, cond`,
        );
        continue;
      }

      if (arg.value === 'jump') {
        const target = node.children[++i];
        if (target?.type === 'atom' && !scope.labels.has(target.value)) {
          addDiagnostic(
            diagnostics,
            document,
            target.start,
            target.end,
            `Unknown label '${target.value}'`,
          );
        }
      } else {
        i++; // skip the cond expression
      }
    }
    return;
  }

  // char, character name, then exp/pos/rot sub-keyword pairs.
  // pos/rot take a list; exp takes an atom. All are inline siblings, not nested nodes.
  // e.g. (char Rien exp standing.png pos (10, 5) rot (0, 180, 0))
  if (name === 'char') {
    for (let i = 2; i < node.children.length; i++) {
      const arg = node.children[i];
      if (arg.type !== 'atom' || arg.kind !== 'symbol') {
        continue;
      }

      if (arg.value !== 'exp' && arg.value !== 'pos' && arg.value !== 'rot') {
        addDiagnostic(
          diagnostics,
          document,
          arg.start,
          arg.end,
          `Unknown char keyword '${arg.value}', expected: exp, pos, rot`,
        );
        continue;
      }

      if (arg.value === 'exp') {
        i++; // skip the portrait filename atom
        continue;
      }

      const listArg = node.children[++i];
      const [label, size, hint] =
        arg.value === 'pos' ? ['pos', 2, '(x, y)'] : ['rot', 3, '(x, y, z)'];

      if (!listArg || listArg.type !== 'list') {
        addDiagnostic(
          diagnostics,
          document,
          arg.start,
          arg.end,
          `'${label}' requires a coordinate list, e.g. ${label} ${hint}`,
        );
        continue;
      }

      if (listArg.children.length !== size) {
        addDiagnostic(
          diagnostics,
          document,
          listArg.start,
          listArg.end,
          `'${label}' list must have exactly ${size} values ${hint}, got ${listArg.children.length}`,
        );
        continue;
      }

      for (const coord of listArg.children) {
        if (coord.type !== 'atom' || coord.kind !== 'number')
          addDiagnostic(
            diagnostics,
            document,
            coord.start,
            coord.end,
            `'${label}' values must be numbers`,
          );
      }
    }
    return;
  }

  // after, code blocks, then jump/end/load sub-keyword pairs
  if (name === 'after') {
    for (let i = 1; i < node.children.length; i++) {
      const arg = node.children[i];

      if (arg.type === 'list') {
        validateNode(arg, scope, diagnostics, document);
        continue;
      }

      if (arg.type !== 'atom' || arg.kind !== 'symbol') {
        continue;
      }

      if (arg.value !== 'jump' && arg.value !== 'end' && arg.value !== 'load') {
        addDiagnostic(
          diagnostics,
          document,
          arg.start,
          arg.end,
          `Unknown after keyword '${arg.value}', expected: jump, end, load`,
        );
        continue;
      }

      if (arg.value === 'jump') {
        const target = node.children[++i];
        if (target?.type === 'atom' && !scope.labels.has(target.value)) {
          addDiagnostic(
            diagnostics,
            document,
            target.start,
            target.end,
            `Unknown label '${target.value}'`,
          );
        }
      } else if (arg.value === 'load') {
        i++; // skip the path
      }
    }
    return;
  }

  // expression keywords and user-defined functions, every arg is a value
  if (ExpressionKeywords.has(name) || scope.functions.has(name)) {
    for (const child of node.children.slice(1)) {
      validateValue(child, scope, diagnostics, document);
    }
    return;
  }

  // everything else (sound, music, bg, load, etc.), atoms are names/paths,
  // only recurse into list children for nested expressions
  for (const child of node.children.slice(1)) {
    if (child.type === 'list') {
      validateNode(child, scope, diagnostics, document);
    }
  }
}

function validateDefun(
  node: ListNode,
  scope: Scope,
  diagnostics: Diagnostic[],
  document: TextDocument,
) {
  const name = node.children[1];
  const params = node.children[2];

  if (!name || name.type !== 'atom') {
    addDiagnostic(
      diagnostics,
      document,
      node.start,
      node.end,
      "'defun' requires a function name as its first argument",
    );
    return;
  }

  if (!NamePattern.test(name.value)) {
    addDiagnostic(
      diagnostics,
      document,
      name.start,
      name.end,
      `Invalid function name '${name.value}'`,
    );
    return;
  }

  const localScope: Scope = {
    functions: scope.functions,
    labels: scope.labels,
    vars: new Set(scope.vars),
  };

  if (params) {
    if (params.type !== 'list') {
      addDiagnostic(
        diagnostics,
        document,
        params.start,
        params.end,
        "'defun' parameter list must be wrapped in parentheses, e.g. (param1 param2)",
      );
    } else {
      for (const param of params.children) {
        if (param.type !== 'atom') {
          continue;
        }

        if (!NamePattern.test(param.value)) {
          addDiagnostic(
            diagnostics,
            document,
            param.start,
            param.end,
            `Invalid parameter name '${param.value}'`,
          );
          continue;
        }

        localScope.vars.add(param.value);
      }
    }
  }

  for (const child of node.children.slice(3)) {
    validateNode(child, localScope, diagnostics, document);
  }
}

function validateValue(
  node: Node,
  scope: Scope,
  diagnostics: Diagnostic[],
  document: TextDocument,
) {
  if (node.type === 'list') {
    validateNode(node, scope, diagnostics, document);
    return;
  }

  if (node.kind === 'string' || node.kind === 'number') {
    return;
  }

  if (NonCallable.has(node.value)) {
    return;
  }

  const value = node.value;

  if (value.startsWith('$')) {
    if (!GlobalVarPattern.test(value)) {
      addDiagnostic(
        diagnostics,
        document,
        node.start,
        node.end,
        `Invalid global variable name '${value}'`,
      );
    }
    return;
  }

  if (!scope.vars.has(value) && !scope.functions.has(value)) {
    addDiagnostic(
      diagnostics,
      document,
      node.start,
      node.end,
      `Unknown variable '${value}'`,
    );
  }
}
