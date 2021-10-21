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
