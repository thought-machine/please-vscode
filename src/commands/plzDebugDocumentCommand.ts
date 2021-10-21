import * as vscode from 'vscode';

import { Language } from '../languages/constants';
import { languageTargetDebuggers } from '../languages/debug';

import { retrieveInputFileTarget } from './utils';

export async function plzDebugDocumentCommand(args: {
  document: vscode.TextDocument;
  functionName?: string;
  language: Language;
}): Promise<void> {
  try {
    const {
      document: { fileName },
      functionName,
      language,
    } = args;

    const debugTarget = languageTargetDebuggers[language];
    if (!debugTarget) {
      throw new Error(
        `The following language has no debugging support yet: ${language}.`
      );
    }

    const target = await retrieveInputFileTarget(fileName);
    if (target === undefined) {
      return;
    }

    debugTarget(target, functionName ? [functionName] : []);
  } catch (e) {
    vscode.window.showErrorMessage(e.message);
  }
}
