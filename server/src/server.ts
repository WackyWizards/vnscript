import {
  createConnection,
  TextDocuments,
  Diagnostic,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  InitializeResult,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Settings } from './settings';
import { validateScript } from './validation';
import { tryUpdateKeywords } from './keywords';
import { Keywords } from '../../shared/out/keywords';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  hasConfigurationCapability = capabilities.workspace?.configuration ?? false;

  hasWorkspaceFolderCapability =
    capabilities.workspace?.workspaceFolders ?? false;

  hasDiagnosticRelatedInformationCapability =
    capabilities.textDocument?.publishDiagnostics?.relatedInformation ?? false;

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { resolveProvider: true },
    },
  };

  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = { workspaceFolders: { supported: true } };
  }

  return result;
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined,
    );
  }

  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders(() => {
      connection.console.log('Workspace folder change event received.');
    });
  }

  console.info('VNScript LSP Server Initialized!');
  tryUpdateKeywords();
});

const defaultSettings: Settings = { maxNumberOfProblems: 1000 };
let globalSettings: Settings = defaultSettings;

// Cache per document
const documentSettings: Map<string, Thenable<Settings>> = new Map();

connection.onDidChangeConfiguration((change) => {
  if (hasConfigurationCapability) {
    documentSettings.clear();
  } else {
    globalSettings = change.settings.vnscript || defaultSettings;
  }

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
      section: 'vnscript',
    });
    documentSettings.set(resource, result);
  }

  return result;
}

documents.onDidClose((e) => documentSettings.delete(e.document.uri));

documents.onDidChangeContent((change) => validateTextDocument(change.document));

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const diagnostics: Diagnostic[] = [];

  try {
    const text = textDocument.getText();
    validateScript(text, textDocument, diagnostics);
  } catch (err) {
    diagnostics.push({
      severity: 1,
      range: {
        start: textDocument.positionAt(0),
        end: textDocument.positionAt(1),
      },
      message: err instanceof Error ? err.message : String(err),
      source: 'vnscript',
    });
  }

  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(() => {
  connection.console.log('We received a file change event');
});

const CompletionKinds: Record<string, CompletionItemKind> = {
  label: CompletionItemKind.Module,
  dialogue: CompletionItemKind.Event,
  set: CompletionItemKind.Variable,
  defun: CompletionItemKind.Function,
};

connection.onCompletion((_pos: TextDocumentPositionParams): CompletionItem[] =>
  Object.entries(Keywords).map(([key, info]) => ({
    label: key,
    kind: CompletionKinds[key] ?? CompletionItemKind.Keyword,
    detail: info.description,
  })),
);

connection.onCompletionResolve((item: CompletionItem): CompletionItem => item);

documents.listen(connection);
connection.listen();
