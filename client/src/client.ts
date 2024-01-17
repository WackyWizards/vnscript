import * as path from 'path';
import { workspace, languages, ExtensionContext } from 'vscode';
import { HoverProvider } from './hoverprovider';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
	context.subscriptions.push(
		languages.registerHoverProvider('vnscript', new HoverProvider())
	);

	const serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);

	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
		}
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'vnscript' }],
		synchronize: {
			fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
		}
	};

	client = new LanguageClient(
		'vnscript-client',
		'vnscript-client',
		serverOptions,
		clientOptions
	);
	
	client.start();
	console.info("VNScript client initialized!");
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) 
	{
		return undefined;
	}

	return client.stop();
}
