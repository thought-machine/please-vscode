import * as vscode from 'vscode';

import { Language } from '../languages/constants';
import { languageTargetDebuggers } from '../languages/debug';

import { argumentPrompt } from './utils';

export async function plzDebugTargetCommand(args: {
  target: string;
  language: Language;
}): Promise<void> {
  try {
    if (vscode.debug.activeDebugSession) {
      throw new Error('Debug session has already been initialised');
    }

    const debugTarget = languageTargetDebuggers[args.language];
    if (!debugTarget) {
      throw new Error(
        `The following language has no debugging support yet: ${args.language}.`
      );
    }

    const runtimeArgs = await argumentPrompt(`key-debug-${args.target}`);
    // Terminate if `Escape` key was pressed.
    if (runtimeArgs === undefined) {
      return;
    }

    debugTarget(args.target, runtimeArgs ? runtimeArgs.split(' ') : []);
  } catch (e) {
    vscode.window.showErrorMessage(e.message);
  }
}
