import * as path from 'path';
import { workspace, ExtensionContext, languages, IndentAction } from 'vscode';

import {
    Executable,
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
	languages.setLanguageConfiguration('plz', {
		onEnterRules: [
			{
				beforeText: /^\s*(?:def|for|if|elif|else).*?:\s*$/,
				action: { indentAction: IndentAction.Indent }
			}
		]
	});
	let serverOptions: ServerOptions = {
		run: {
            command: 'plz',
            args: ['tool', 'langserver'],
        },
		debug: {
            command: 'plz',
            args: ['tool', 'langserver', '-v', '4'],
		}
	};
	let clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'plz' }],
		synchronize: {
			fileEvents: workspace.createFileSystemWatcher('BUILD*')
		}
	};
	client = new LanguageClient(
		'plzLanguageServer',
		'Please Language Server',
		serverOptions,
		clientOptions
	);
	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
