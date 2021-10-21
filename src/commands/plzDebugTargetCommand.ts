import * as vscode from 'vscode';

import { Language } from '../languages/constants';
import { languageTargetDebuggers } from '../languages/debug';

export async function plzDebugTargetCommand(args: {
  target: string;
  language: Language;
}): Promise<void> {
  const debugTarget = languageTargetDebuggers[args.language];
  if (!debugTarget) {
    vscode.window.showErrorMessage(
      `The following language has no debugging support yet: ${args.language}.`
    );
    return;
  }

  const runtimeArgs = await vscode.window.showInputBox({
    placeHolder: 'Enter arguments or leave blank',
  });
  // Terminate if `Escape` key was pressed.
  if (runtimeArgs === undefined) {
    return;
  }

  debugTarget(args.target, runtimeArgs ? runtimeArgs.split(' ') : []);
}
