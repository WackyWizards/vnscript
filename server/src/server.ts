import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Settings } from './settings';
import * as keywordData from '../../keywords.json';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);

	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);

	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider: {
				resolveProvider: true
			}
		}
	};

	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}

	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}

	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}

	console.info("VNScript LSP Server Initialized!");
});

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: Settings = { maxNumberOfProblems: 1000 };
let globalSettings: Settings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<Settings>> = new Map();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <Settings>(
			(change.settings.languageServerExample || defaultSettings)
		);
	}

	// Revalidate all open text documents
	documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<Settings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}

	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'vnscript-server'
		});
		documentSettings.set(resource, result);
	}

	return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
	validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	const settings = await getDocumentSettings(textDocument.uri);
	const text = textDocument.getText();

	const diagnostics: Diagnostic[] = [];

	validateLabels(text, textDocument, diagnostics);
	validateStartDialogues(text, textDocument, diagnostics);

	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

function validateLabels(text: string, textDocument: TextDocument, diagnostics: Diagnostic[]) {
    const labelPattern = /\(label\s+([^\s)]*)?\s*((?:\(.*?\)|\s)*?)(?=\))/gs;
    let labelMatch: RegExpExecArray | null;

    while ((labelMatch = labelPattern.exec(text))) {
        const labelName = labelMatch[1];
        const labelContent = labelMatch[2];

        if (!labelName) {
            addDiagnostic(diagnostics, DiagnosticSeverity.Error, textDocument, labelMatch, `Labels need to feature a name.`);
        }

		if (!labelContent)
		{
			addDiagnostic(diagnostics, DiagnosticSeverity.Error, textDocument, labelMatch, `Labels need to feature content.`);
		}

        // Check if the label contains (text "")
        const textPattern = /\(text\s+"([^"]*)"\s*(?:\w+\s*[^)]*)?\)/g;
        const textMatches = [...labelContent.matchAll(textPattern)];

        if (textMatches.length === 0) {
            addDiagnostic(diagnostics, DiagnosticSeverity.Error, textDocument, labelMatch, `Label '${labelName}' should include '(text "")' content.`);
        } else if (textMatches.length > 1) {
            addDiagnostic(diagnostics, DiagnosticSeverity.Error, textDocument, labelMatch, `Label '${labelName}' should only include one text keyword.`);
        }

        // Check for common background asset issues
        const bgPattern = /\(bg\s+([^\s]+)\)/g;
        const bgMatches = [...labelContent.matchAll(bgPattern)];

        if (bgMatches.length > 1) {
            addDiagnostic(diagnostics, DiagnosticSeverity.Error, textDocument, labelMatch, `There can only be one 'bg' keyword in a label.`);
        }

        for (const bgMatch of bgMatches) {
            const bgKeyword = bgMatch[0];
            const index = bgMatch.index;

            if (index !== undefined && !bgKeyword.includes('.')) {
                addDiagnostic(diagnostics, DiagnosticSeverity.Error, textDocument, bgMatch, `'bg' keyword needs to feature the file extension.`);
            }
        }
    }
}

function validateStartDialogues(text: string, textDocument: TextDocument, diagnostics: Diagnostic[]) {
    const startDialoguePattern = /\(start-dialogue\s+([^\s]+)\)/g;
    let startDialogueMatch: RegExpExecArray | null;
    const startDialogues: string[] = [];

    while ((startDialogueMatch = startDialoguePattern.exec(text))) {
        const startDialogueName = startDialogueMatch[1];
        startDialogues.push(startDialogueName);

        // Check if the label with the same name exists
        const labelPattern = new RegExp(`\\(label\\s+${startDialogueName}\\s*((?:\\(.*?\\)|\\s)*?)(?=\\))`, 'gs');

		// If not, yell about it.
        if (!labelPattern.test(text)) {
            addDiagnostic(diagnostics, DiagnosticSeverity.Error, textDocument, startDialogueMatch, `No label found with the name '${startDialogueName}'.`);
        }
    }

    if (startDialogues.length === 0) {
        addDiagnostic(diagnostics, DiagnosticSeverity.Error, textDocument, { index: 0, length: text.length, input: text }, `No 'start-dialogue' specified, the script won't know where to start!`);
    }
}

function addDiagnostic(diagnostics: Diagnostic[], severity: DiagnosticSeverity, textDocument: TextDocument, match: RegExpMatchArray | { index: number; length: number; input: string; }, message: string) {
	const diagnostic: Diagnostic = {
		severity: DiagnosticSeverity.Error,
		range: {
			start: textDocument.positionAt(match.index || 0),
			end: textDocument.positionAt((match.index || 0) + (match.length || 0)),
		},
		message: message,
		source: 'ex',
	};
	diagnostics.push(diagnostic);
}

connection.onDidChangeWatchedFiles(_change => {
	connection.console.log('We received a file change event');
});
  
connection.onCompletion(
	(_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
		const completionItems: CompletionItem[] = [];

		for (const [key, value] of Object.entries(keywordData)) {
			const completionItem: CompletionItem = {
				label: key,
				kind: CompletionItemKind.Text,
				detail: value,
			};
  
			completionItems.push(completionItem);
		}		
  
		return completionItems;
	}
);
  
// Resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {
		return item;
	}
);

documents.listen(connection);
connection.listen();
