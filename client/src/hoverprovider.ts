import * as vscode from 'vscode';
import { Keywords } from '../../shared/out/keywords';

export class HoverProvider implements vscode.HoverProvider {
  provideHover(document: vscode.TextDocument, position: vscode.Position) {
    const range = document.getWordRangeAtPosition(
      position,
      /[a-zA-Z0-9_+\-*/!=<>]+/,
    );
    if (!range) {
      return;
    }

    const word = document.getText(range);
    const info = Keywords[word];
    if (!info) {
      return;
    }

    return new vscode.Hover(buildHover(word, info), range);
  }
}

function buildHover(word: string, info: any): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  md.supportHtml = true;

  const category = info.category
    ? ` &nbsp;$(symbol-keyword) *${cap(info.category)}*`
    : '';
  md.appendMarkdown(`**${word}**${category}\n\n`);

  if (info.signature) {
    md.appendMarkdown(`\`\`\`vnscript\n${info.signature.trim()}\n\`\`\`\n`);
  }

  md.appendMarkdown(`${escape(info.description)}\n`);

  const meta: string[] = [];

  if (info.expressionArgs) {
    meta.push(`$(symbol-operator) *expression args*`);
  }

  if (info.returns) {
    meta.push(`Returns \`${info.returns}\``);
  }

  if (meta.length) {
    md.appendMarkdown(`\n---\n${meta.join(' &nbsp;·&nbsp; ')}\n`);
  }

  if (info.subkeywords?.length) {
    md.appendMarkdown(
      `\n**Subkeywords** &nbsp;${info.subkeywords.map((s: string) => `\`${s}\``).join(' ')}\n`,
    );
  }

  if (info.example) {
    md.appendMarkdown(
      `\n---\n**Example**\n\`\`\`vnscript\n${info.example.trim()}\n\`\`\`\n`,
    );
  }

  return md;
}

const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
const escape = (v: string) => v.replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&');
