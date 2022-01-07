import * as vscode from 'vscode';

import * as plz from '../please';

export async function retrieveInputFileTarget(
  filename: string
): Promise<string | undefined> {
  const targets = plz.inputTargets(filename);

  switch (targets.length) {
    case 0:
      throw new Error(
        `A target couldn't be found where the file is a source: ${filename}`
      );

    case 1:
      return targets[0];

    default:
      // Returns `undefined` if the user presses `Escape` during the quick pick.
      return await vscode.window.showQuickPick(targets, {
        placeHolder: 'Select the associated target',
      });
  }
}

const argumentPromptStore: { [key: string]: string } = {};

export async function argumentPrompt(
  options: { key?: string; placeholder?: string } = {}
): Promise<string | undefined> {
  const input = await vscode.window.showInputBox({
    placeHolder:
      options.placeholder ?? 'Enter program arguments or leave blank',
    value: argumentPromptStore[options.key] ?? '',
  });

  if (options.key) {
    argumentPromptStore[options.key] = input;
  }

  return input;
}
