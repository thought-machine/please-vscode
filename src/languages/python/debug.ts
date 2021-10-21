import * as vscode from 'vscode';

import { LANGUAGE_DEBUG_IDS } from '../constants';

export async function debug(
  target: string,
  runtimeArgs: string[]
): Promise<boolean> {
  const debugConfig: vscode.DebugConfiguration = {
    type: LANGUAGE_DEBUG_IDS.python,
    request: 'attach',
    name: 'Please Python',
    target,
    runtimeArgs,
  };

  return await vscode.debug.startDebugging(undefined, debugConfig);
}
