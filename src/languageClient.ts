import * as vscode from 'vscode';
import {
  LanguageClient,
  RevealOutputChannelOn,
} from 'vscode-languageclient/node';

import * as plz from './please';

export function startLanguageClient(): vscode.Disposable {
  vscode.languages.setLanguageConfiguration('plz', {
    onEnterRules: [
      {
        beforeText: /^\s*(?:def|for|if|elif|else).*?:\s*$/,
        action: { indentAction: vscode.IndentAction.Indent },
      },
    ],
  });

  const client = new LanguageClient(
    'plz',
    'Please Language Server',
    {
      run: {
        command: plz.binPath(),
        args: ['tool', 'langserver'],
      },
      debug: {
        command: plz.binPath(),
        args: ['tool', 'langserver', '-v', '4'],
      },
    },
    {
      documentSelector: [{ scheme: 'file', language: 'plz' }],
      synchronize: {
        fileEvents: vscode.workspace.createFileSystemWatcher('BUILD*'),
      },
      revealOutputChannelOn: RevealOutputChannelOn.Never,
    }
  );
  return client.start();
}
