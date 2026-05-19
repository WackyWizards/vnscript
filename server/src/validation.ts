import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { tokenize } from './tokenizer';
import { parse } from './parser';
import { Node, ListNode, AtomNode } from './types';
import { Keywords } from '../../shared/out/keywords';
import { ArgumentReader } from './argumentReader';

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

export interface Token {
  value: string;
  start: number;
  end: number;
}

export class TokenizeError extends Error {
  constructor(
    message: string,
    public readonly offset: number,
  ) {
    super(message);
  }
}

interface Scope {
  functions: Set<string>;
  vars: Set<string>;
  labels: Set<string>;
}

interface ValidationContext {
  scope: Scope;
  diagnostics: Diagnostic[];
  document: TextDocument;
}

function childContext(
  ctx: ValidationContext,
  scopeOverrides?: Partial<Scope>,
): ValidationContext {
  return {
    ...ctx,
    scope: { ...ctx.scope, ...scopeOverrides },
  };
}

// Called from validateNode when the head symbol matches.
type KeywordValidator = (node: ListNode, ctx: ValidationContext) => void;

const KeywordValidators: Record<string, KeywordValidator> = {
  label: validateLabel,
  defun: validateDefun,
  set: validateSet,
  input: validateInput,
  jump: validateJumpOrStart,
  start: validateJumpOrStart,
  dialogue: validateDialogue,
  choice: validateChoice,
  char: validateChar,
  after: validateAfter,
  sound: validateSound,
  music: (node, ctx) => requireStringFirstArg(node, ctx, 'a music name string'),
  bg: (node, ctx) => requireStringFirstArg(node, ctx, 'an image name string'),
};

// Called when a named sub-keyword is encountered inside a keyword's arg list.
// `reader` is positioned just after the sub-keyword atom.
// `kwNode` is the sub-keyword atom itself, used as a fallback error location.
type SubkeywordHandler = (
  reader: ArgumentReader,
  kwNode: AtomNode,
  ctx: ValidationContext,
) => void;

function addDiagnostic(
  ctx: ValidationContext,
  start: number,
  end: number,
  message: string,
  severity = DiagnosticSeverity.Error,
): void {
  ctx.diagnostics.push({
    severity,
    range: {
      start: ctx.document.positionAt(start),
      end: ctx.document.positionAt(end),
    },
    message,
    source: 'vnscript',
  });
}

function validateVarName(
  node: AtomNode,
  ctx: ValidationContext,
): 'local' | 'global' | 'invalid' {
  if (node.value.startsWith('$')) {
    if (!GlobalVarPattern.test(node.value)) {
      addDiagnostic(
        ctx,
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
      ctx,
      node.start,
      node.end,
      `Invalid variable name '${node.value}'`,
    );
    return 'invalid';
  }

  return 'local';
}

/** Reads the next arg from reader and validates it as a known label name. */
function validateLabelRef(
  reader: ArgumentReader,
  kwNode: AtomNode,
  ctx: ValidationContext,
): void {
  const target = reader.read();
  if (!target) {
    addDiagnostic(
      ctx,
      kwNode.start,
      kwNode.end,
      `'${kwNode.value}' requires a label name argument`,
    );
  } else if (target.type !== 'atom' || target.kind !== 'symbol') {
    addDiagnostic(
      ctx,
      target.start,
      target.end,
      `'${kwNode.value}' target must be a label name, not a ${target.type === 'list' ? 'list' : target.kind}`,
    );
  } else if (!ctx.scope.labels.has(target.value)) {
    addDiagnostic(
      ctx,
      target.start,
      target.end,
      `Unknown label '${target.value}'`,
    );
  }
}

/** Checks that the keyword's first positional argument (index 1) is a string. */
function requireStringFirstArg(
  node: ListNode,
  ctx: ValidationContext,
  description: string,
): void {
  const arg = node.children[1];
  const keyword = (node.children[0] as AtomNode).value;
  if (!arg || arg.type !== 'atom' || arg.kind !== 'string') {
    addDiagnostic(
      ctx,
      node.start,
      node.end,
      `'${keyword}' requires ${description} as its first argument`,
    );
  }
}

/** Reads the next arg from reader as a coordinate list and validates it. */
function validateCoordList(
  reader: ArgumentReader,
  kwNode: AtomNode,
  ctx: ValidationContext,
  size: number,
  hint: string,
): void {
  const listArg = reader.read();
  const label = kwNode.value;

  if (!listArg || listArg.type !== 'list') {
    addDiagnostic(
      ctx,
      kwNode.start,
      kwNode.end,
      `'${label}' requires a coordinate list, e.g. ${label} ${hint}`,
    );
    return;
  }

  if (listArg.children.length !== size) {
    addDiagnostic(
      ctx,
      listArg.start,
      listArg.end,
      `'${label}' list must have exactly ${size} values ${hint}, got ${listArg.children.length}`,
    );
    return;
  }

  for (const coord of listArg.children) {
    if (coord.type !== 'atom' || coord.kind !== 'number') {
      addDiagnostic(
        ctx,
        coord.start,
        coord.end,
        `'${label}' values must be numbers`,
      );
    }
  }
}

const AfterSubkeywords: Record<string, SubkeywordHandler> = {
  end: () => {},
  jump: (reader, kwNode, ctx) => validateLabelRef(reader, kwNode, ctx),
  load: (reader, kwNode, ctx) => {
    if (!reader.read()) {
      addDiagnostic(
        ctx,
        kwNode.start,
        kwNode.end,
        "'load' requires a file path argument",
      );
    }
  },
};

const ChoiceSubkeywords: Record<string, SubkeywordHandler> = {
  jump: (reader, kwNode, ctx) => validateLabelRef(reader, kwNode, ctx),
  cond: (reader, kwNode, ctx) => {
    const condExpr = reader.read();
    if (!condExpr) {
      addDiagnostic(
        ctx,
        kwNode.start,
        kwNode.end,
        "'cond' requires an expression argument",
      );
    } else if (condExpr.type !== 'list') {
      addDiagnostic(
        ctx,
        condExpr.start,
        condExpr.end,
        "'cond' requires an expression, e.g. (= x 1)",
      );
    } else {
      validateNode(condExpr, ctx);
    }
  },
};

const DialogueSubkeywords: Record<string, SubkeywordHandler> = {
  speaker: (reader, kwNode, ctx) => {
    const arg = reader.read();
    if (!arg) {
      addDiagnostic(
        ctx,
        kwNode.start,
        kwNode.end,
        "'speaker' requires a character name argument",
      );
    } else if (arg.type !== 'atom' || arg.kind !== 'symbol') {
      addDiagnostic(
        ctx,
        arg.start,
        arg.end,
        "'speaker' requires a character name, not a " +
          (arg.type === 'list' ? 'list' : arg.kind),
      );
    }
  },
};

const CharSubkeywords: Record<string, SubkeywordHandler> = {
  exp: (reader) => {
    reader.read();
  }, // consume portrait filename
  pos: (reader, kwNode, ctx) =>
    validateCoordList(reader, kwNode, ctx, 2, '(x, y)'),
  rot: (reader, kwNode, ctx) =>
    validateCoordList(reader, kwNode, ctx, 3, '(x, y, z)'),
};

const SoundSubkeywords: Record<string, SubkeywordHandler> = {
  mixer: (reader, kwNode, ctx) => {
    const arg = reader.read();
    if (!arg) {
      addDiagnostic(
        ctx,
        kwNode.start,
        kwNode.end,
        "'mixer' requires a mixer name argument",
      );
    } else if (arg.type !== 'atom' || arg.kind !== 'string') {
      addDiagnostic(
        ctx,
        arg.start,
        arg.end,
        "'mixer' requires a string mixer name",
      );
    }
  },
};

function validateLabel(node: ListNode, ctx: ValidationContext): void {
  const labelName = node.children[1];
  if (!labelName || labelName.type !== 'atom' || labelName.kind !== 'symbol') {
    addDiagnostic(
      ctx,
      node.start,
      node.end,
      "'label' requires a name as its first argument",
    );
    return;
  }

  // input and choice are mutually exclusive within a label
  const body = node.children.slice(2);
  const firstKeyword = (v: string) =>
    body.some(
      (c) =>
        c.type === 'list' &&
        c.children[0]?.type === 'atom' &&
        c.children[0].value === v,
    );

  if (firstKeyword('choice') && firstKeyword('input')) {
    addDiagnostic(
      ctx,
      node.start,
      node.end,
      "Cannot use 'input' in a label that also has 'choice'",
    );
  }

  // label body runs in its own scope so local vars don't leak out
  const labelCtx = childContext(ctx, { vars: new Set(ctx.scope.vars) });
  for (const child of body) {
    validateNode(child, labelCtx);
  }
}

function validateDefun(node: ListNode, ctx: ValidationContext): void {
  const name = node.children[1];
  const params = node.children[2];

  if (!name || name.type !== 'atom') {
    addDiagnostic(
      ctx,
      node.start,
      node.end,
      "'defun' requires a function name as its first argument",
    );
    return;
  }

  if (!NamePattern.test(name.value)) {
    addDiagnostic(
      ctx,
      name.start,
      name.end,
      `Invalid function name '${name.value}'`,
    );
    return;
  }

  const localCtx = childContext(ctx, { vars: new Set(ctx.scope.vars) });

  if (params) {
    if (params.type !== 'list') {
      addDiagnostic(
        ctx,
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
            ctx,
            param.start,
            param.end,
            `Invalid parameter name '${param.value}'`,
          );
          continue;
        }
        localCtx.scope.vars.add(param.value);
      }
    }
  }

  for (const child of node.children.slice(3)) {
    validateNode(child, localCtx);
  }
}

function validateSet(node: ListNode, ctx: ValidationContext): void {
  const argCount = node.children.length - 1;
  if (argCount % 2 !== 0) {
    addDiagnostic(
      ctx,
      node.start,
      node.end,
      `'set' requires an even number of arguments (key-value pairs), got ${argCount}`,
    );
  }

  for (let i = 1; i < node.children.length - 1; i += 2) {
    const varName = node.children[i];
    const value = node.children[i + 1];

    if (varName.type !== 'atom' || varName.kind !== 'symbol') {
      addDiagnostic(
        ctx,
        varName.start,
        varName.end,
        'Variable name must be a symbol',
      );
    } else {
      const kind = validateVarName(varName, ctx);
      if (kind === 'local') {
        ctx.scope.vars.add(varName.value);
      }
    }

    if (value) {
      validateValue(value, ctx);
    }
  }
}

function validateInput(node: ListNode, ctx: ValidationContext): void {
  const varName = node.children[1];
  if (!varName) {
    return;
  }

  if (varName.type !== 'atom' || varName.kind !== 'symbol') {
    addDiagnostic(
      ctx,
      varName.start,
      varName.end,
      'Variable name must be a symbol',
    );
  } else {
    const kind = validateVarName(varName, ctx);
    if (kind === 'local') {
      ctx.scope.vars.add(varName.value);
    }
  }
}

function validateJumpOrStart(node: ListNode, ctx: ValidationContext): void {
  const name = (node.children[0] as AtomNode).value;
  const target = node.children[1];
  if (!target) {
    return;
  }

  if (target.type !== 'atom' || target.kind !== 'symbol') {
    addDiagnostic(
      ctx,
      target.start,
      target.end,
      `'${name}' target must be a label name, not a ${target.type === 'list' ? 'list' : target.kind}`,
    );
  } else if (!ctx.scope.labels.has(target.value)) {
    addDiagnostic(
      ctx,
      target.start,
      target.end,
      `Unknown label '${target.value}'`,
    );
  }
}

function validateDialogue(node: ListNode, ctx: ValidationContext): void {
  const reader = new ArgumentReader(node.children, 1);
  const isDialogueKeyword = (n: Node) =>
    n.type === 'atom' && n.kind === 'symbol' && n.value in DialogueSubkeywords;

  // collect text parts before the first keyword
  const textArgs: Node[] = [];
  while (reader.hasMore && !isDialogueKeyword(reader.peek()!)) {
    textArgs.push(reader.read()!);
  }

  if (textArgs.length === 0) {
    addDiagnostic(
      ctx,
      node.start,
      node.end,
      "'dialogue' requires at least one text argument (string, variable, or expression)",
    );
    return;
  }

  for (const part of textArgs) {
    if (part.type === 'list') {
      validateNode(part, ctx);
    } else if (part.kind === 'symbol') {
      validateValue(part, ctx);
    }
  }

  // process keyword/argument pairs
  while (reader.hasMore) {
    const kw = reader.read()!;
    if (kw.type !== 'atom' || kw.kind !== 'symbol') {
      addDiagnostic(
        ctx,
        kw.start,
        kw.end,
        "Expected a keyword (e.g. 'speaker')",
      );
      continue;
    }
    const handler = DialogueSubkeywords[kw.value];
    if (!handler) {
      addDiagnostic(
        ctx,
        kw.start,
        kw.end,
        `Unknown dialogue keyword '${kw.value}'`,
      );
      reader.read(); // skip the dangling argument
      continue;
    }
    handler(reader, kw, ctx);
  }
}

function validateChoice(node: ListNode, ctx: ValidationContext): void {
  const text = node.children[1];
  if (text?.type !== 'atom' || text.kind !== 'string') {
    addDiagnostic(
      ctx,
      node.start,
      node.end,
      "'choice' requires a display string as its first argument",
    );
  }

  const reader = new ArgumentReader(node.children, 2);
  while (reader.hasMore) {
    const arg = reader.peek()!;
    if (arg.type !== 'atom' || arg.kind !== 'symbol') {
      reader.read();
      continue;
    }
    reader.read();

    const handler = ChoiceSubkeywords[arg.value];
    if (!handler) {
      addDiagnostic(
        ctx,
        arg.start,
        arg.end,
        `Unknown choice keyword '${arg.value}', expected: ${Object.keys(ChoiceSubkeywords).join(', ')}`,
      );
      continue;
    }
    handler(reader, arg, ctx);
  }
}

function validateChar(node: ListNode, ctx: ValidationContext): void {
  const charName = node.children[1];
  if (!charName || charName.type !== 'atom' || charName.kind !== 'symbol') {
    addDiagnostic(
      ctx,
      node.start,
      node.end,
      "'char' requires a character name as its first argument",
    );
    return;
  }

  const reader = new ArgumentReader(node.children, 2);
  while (reader.hasMore) {
    const arg = reader.peek()!;
    if (arg.type !== 'atom' || arg.kind !== 'symbol') {
      reader.read();
      continue;
    }
    reader.read();

    const handler = CharSubkeywords[arg.value];
    if (!handler) {
      addDiagnostic(
        ctx,
        arg.start,
        arg.end,
        `Unknown char keyword '${arg.value}', expected: ${Object.keys(CharSubkeywords).join(', ')}`,
      );
      continue;
    }

    handler(reader, arg, ctx);
  }
}

function validateSound(node: ListNode, ctx: ValidationContext): void {
  requireStringFirstArg(node, ctx, 'a sound name string');

  const reader = new ArgumentReader(node.children, 2);
  while (reader.hasMore) {
    const arg = reader.peek()!;
    if (arg.type !== 'atom' || arg.kind !== 'symbol') {
      reader.read();
      continue;
    }

    reader.read();

    const handler = SoundSubkeywords[arg.value];
    if (!handler) {
      addDiagnostic(
        ctx,
        arg.start,
        arg.end,
        `Unknown sound keyword '${arg.value}', expected: ${Object.keys(SoundSubkeywords).join(', ')}`,
      );
      continue;
    }

    handler(reader, arg, ctx);
  }
}

function validateAfter(node: ListNode, ctx: ValidationContext): void {
  const reader = new ArgumentReader(node.children, 1);
  while (reader.hasMore) {
    const arg = reader.peek()!;

    // list args are inline code blocks; recurse into them
    if (arg.type === 'list') {
      reader.read();
      validateNode(arg, ctx);
      continue;
    }

    if (arg.type !== 'atom' || arg.kind !== 'symbol') {
      reader.read();
      continue;
    }
    reader.read();

    const handler = AfterSubkeywords[arg.value];
    if (!handler) {
      addDiagnostic(
        ctx,
        arg.start,
        arg.end,
        `Unknown after keyword '${arg.value}', expected: ${Object.keys(AfterSubkeywords).join(', ')}`,
      );
      continue;
    }

    handler(reader, arg, ctx);
  }
}

export function validateScript(
  text: string,
  document: TextDocument,
  diagnostics: Diagnostic[],
): void {
  const scope: Scope = {
    functions: new Set(),
    vars: new Set(),
    labels: new Set(),
  };

  const ctx: ValidationContext = { scope, diagnostics, document };

  let ast: Node[];

  try {
    const tokens = tokenize(text);
    ast = parse(tokens);
  } catch (err) {
    const offset = err instanceof TokenizeError ? err.offset : 0;

    addDiagnostic(
      ctx,
      offset,
      offset + 1,
      err instanceof Error ? err.message : String(err),
    );

    return;
  }

  // pass 1: collect labels + functions
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
        scope.labels.add(name.value);
      }
    }

    if (head.value === 'defun') {
      const name = node.children[1];
      if (name?.type === 'atom') {
        scope.functions.add(name.value);
      }
    }
  }

  // pass 2: validation
  for (const node of ast) {
    validateNode(node, ctx);
  }
}

function validateNode(node: Node, ctx: ValidationContext): void {
  if (node.type !== 'list') {
    return;
  }

  if (node.children.length === 0) {
    addDiagnostic(ctx, node.start, node.end, 'Empty expression');
    return;
  }

  const head = node.children[0];
  if (head.type !== 'atom') {
    addDiagnostic(
      ctx,
      head.start,
      head.end,
      'Expression head must be a symbol',
    );
    return;
  }

  const name = head.value;

  if (NonCallable.has(name)) {
    addDiagnostic(
      ctx,
      head.start,
      head.end,
      `'${name}' is a constant and cannot be used as a keyword`,
    );
    return;
  }

  const knownCallable =
    Builtins.has(name) || Operators.has(name) || ctx.scope.functions.has(name);

  if (!knownCallable) {
    addDiagnostic(ctx, head.start, head.end, `Unknown keyword '${name}'`);
  }

  // arity check
  const arity = Arity[name];
  const argCount = node.children.length - 1;
  if (arity) {
    const [min, max] = arity;
    if (argCount < min) {
      addDiagnostic(
        ctx,
        node.start,
        node.end,
        `'${name}' requires at least ${min} argument${min === 1 ? '' : 's'}, got ${argCount}`,
      );
    } else if (argCount > max) {
      const firstExcess = node.children[max + 1];
      addDiagnostic(
        ctx,
        firstExcess.start,
        node.end,
        `'${name}' accepts at most ${max} argument${max === 1 ? '' : 's'}, got ${argCount}`,
      );
    }
  }

  // dispatch to keyword-specific validator
  const handler = KeywordValidators[name];
  if (handler) {
    handler(node, ctx);
    return;
  }

  // expression keywords and user-defined functions: every arg is a value
  if (ExpressionKeywords.has(name) || ctx.scope.functions.has(name)) {
    for (const child of node.children.slice(1)) {
      validateValue(child, ctx);
    }
    return;
  }

  // everything else: atoms are names/paths; only recurse into list children
  for (const child of node.children.slice(1)) {
    if (child.type === 'list') {
      validateNode(child, ctx);
    }
  }
}

function validateValue(node: Node, ctx: ValidationContext): void {
  if (node.type === 'list') {
    validateNode(node, ctx);
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
        ctx,
        node.start,
        node.end,
        `Invalid global variable name '${value}'`,
      );
    }
    return;
  }

  if (!ctx.scope.vars.has(value) && !ctx.scope.functions.has(value)) {
    addDiagnostic(ctx, node.start, node.end, `Unknown variable '${value}'`);
  }
}
