import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';

export function startLanguageServer(context: vscode.ExtensionContext) {
    vscode.languages.setLanguageConfiguration('plz', {
        onEnterRules: [
            {
                beforeText: /^\s*(?:def|for|if|elif|else).*?:\s*$/,
                action: { indentAction: vscode.IndentAction.Indent }
            }
        ]
    });

    const client = new LanguageClient(
        'plzLanguageServer',
        'Please Language Server',
        {
            run: {
                command: 'plz',
                args: ['tool', 'langserver'],
            },
            debug: {
                command: 'plz',
                args: ['tool', 'langserver', '-v', '4'],
            }
        },
        {
            documentSelector: [{ scheme: 'file', language: 'plz' }],
            synchronize: {
                fileEvents: vscode.workspace.createFileSystemWatcher('BUILD*')
            }
        }
    );

    const languageServerDisposable = client.start();

    context.subscriptions.push(languageServerDisposable);
}