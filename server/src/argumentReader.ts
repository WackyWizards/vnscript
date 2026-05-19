import { Node } from './types';

/**
 * Wraps a children array for sequential, index-safe reads during sub-keyword
 * argument parsing. Mirrors the ArgumentReader pattern used in VNScript's own parser code.
 * The reader does not skip non-atom nodes, since some sub-keywords allow inline code blocks as arguments.
 */
export class ArgumentReader {
  private i: number;

  constructor(
    private readonly children: Node[],
    startIndex = 0,
  ) {
    this.i = startIndex;
  }

  get hasMore(): boolean {
    return this.i < this.children.length;
  }

  peek(): Node | undefined {
    return this.children[this.i];
  }

  read(): Node | undefined {
    return this.children[this.i++];
  }
}
