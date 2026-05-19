import { Token } from './validation';
import { Node, AtomNode } from './types';

export function parse(tokens: Token[]): Node[] {
  let i = 0;

  function parseExpr(): Node {
    const token = tokens[i];
    if (!token) {
      throw new Error('Unexpected End Of File');
    }

    if (token.value === '(') {
      const start = token.start;
      i++;

      const children: Node[] = [];

      while (tokens[i] && tokens[i].value !== ')') {
        children.push(parseExpr());
      }

      const end = tokens[i];
      if (!end) {
        throw new Error("Missing ')'");
      }

      i++;

      return {
        type: 'list',
        children,
        start,
        end: end.end,
      };
    }

    if (token.value === ')') {
      throw new Error("Unexpected ')'");
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

  while (i < tokens.length) {
    nodes.push(parseExpr());
  }

  return nodes;
}
