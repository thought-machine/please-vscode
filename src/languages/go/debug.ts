import * as vscode from 'vscode';

import { LANGUAGE_DEBUG_IDS } from '../constants';

export async function debug(
  target: string,
  runtimeArgs: string[]
): Promise<boolean> {
  const debugConfig: vscode.DebugConfiguration = {
    type: LANGUAGE_DEBUG_IDS.go,
    request: 'launch',
    name: 'Please Go',
    target,
    runtimeArgs,
    // This is used for debugging the adapter via the `Extension + Go Debug Adapter server`
    // debug configuration of this extension.
    //debugServer: 4711,
  };

  return await vscode.debug.startDebugging(undefined, debugConfig);
}
