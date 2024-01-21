import * as vscode from 'vscode';
import * as keywordData from '../../keywords.json';

export class HoverProvider implements vscode.HoverProvider {
  private keywordDescriptions: { [key: string]: string };

  constructor() {
    this.keywordDescriptions = keywordData;
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const hoveredText = document.getText(document.getWordRangeAtPosition(position));
    const hoverText = this.keywordDescriptions[hoveredText];
  
    if (hoverText) {
      return new vscode.Hover(hoverText);
    }
  }
}
