import * as vscode from 'vscode';

import * as plz from '../please';

export async function plzCommand(args: {
  command: string;
  args?: string[];
  runtime?: boolean;
}): Promise<void> {
  const { command, args: commandArgs = [], runtime = false } = args;

  let runtimeArgs: string | undefined;
  if (runtime) {
    runtimeArgs = await vscode.window.showInputBox({
      placeHolder: 'Enter arguments or leave blank',
    });
    // Terminate if `Escape` key was pressed.
    if (runtimeArgs === undefined) {
      return;
    }
  }

  let wholeCommand = [command, ...commandArgs];
  if (runtimeArgs) {
    wholeCommand = [...wholeCommand, '--', ...runtimeArgs.split(' ')];
  }

  plz.spawnCommand(wholeCommand);
}
