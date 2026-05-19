export type Node = ListNode | AtomNode;

export interface ListNode {
  type: 'list';
  children: Node[];
  start: number;
  end: number;
}

export interface AtomNode {
  type: 'atom';
  value: string;
  kind: 'symbol' | 'string' | 'number';
  start: number;
  end: number;
}