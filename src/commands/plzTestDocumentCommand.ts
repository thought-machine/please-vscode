import * as vscode from 'vscode';

import { retrieveInputFileTarget } from './utils';

export async function plzTestDocumentCommand(args: {
  document: vscode.TextDocument;
  functionName?: string;
}): Promise<void> {
  try {
    const {
      document: { fileName },
      functionName,
    } = args;

    const target = await retrieveInputFileTarget(fileName);
    if (target === undefined) {
      return;
    }

    let command = 'test';
    let commandArgs = ['--rerun', target];
    if (functionName) {
      commandArgs = [...commandArgs, '--', functionName];
    }

    vscode.commands.executeCommand('plz', {
      command,
      args: commandArgs,
    });
  } catch (e) {
    vscode.window.showErrorMessage(e.message);
  }
}
