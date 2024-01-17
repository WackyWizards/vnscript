import * as vscode from 'vscode';

// Doesn't allow full words separated by dashes yet...
const keywordInfo: { [keyword: string]: string } = {
	"label": "Labels define different sections in your script.",
	"text": "The text keyword is used to display dialogues.",
	"choice": "The choice keyword allows users to make choices in the script.",
	"jump": "The jump keyword declares that after processing the previous keyword jump to the provided label.",
	"after": "The after keyword in a label indicates what this label will do after it's processed.",
	"say": "When added to a text, defines which character will be added as the speaking character.",
	"sound": "Defines a sound to be played when this label is processed.",
	"bg": "Defines a background image to be displayed when this label is processed. Includes extension."
};

export class HoverProvider implements vscode.HoverProvider {
  private keywordDescriptions: { [key: string]: string };

  constructor() {
    this.keywordDescriptions = keywordInfo;
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
