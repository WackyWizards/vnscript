import { Token, TokenizeError } from './validation';

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < text.length) {
    const c = text[i];

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

    // block comment
    if (c === '/' && text[i + 1] === '*') {
      const start = i;
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
        throw new TokenizeError('Unterminated block comment', start);
      }

      continue;
    }

    // parens
    if (c === '(' || c === ')') {
      tokens.push({ value: c, start: i, end: i + 1 });
      i++;
      continue;
    }

    // string
    if (c === '"') {
      const start = i;
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

      if (j >= text.length) {
        throw new TokenizeError('Unterminated string', start);
      }

      j++;
      tokens.push({ value: text.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }

    // symbol/number
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

function isWhitespaceOrComma(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',';
}
