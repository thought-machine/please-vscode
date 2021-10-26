import * as path from 'path';
import * as vscode from 'vscode';

import * as plz from '../../please';

export const PLZ_GO_DEBUG_MIN_VERSION = '16.1.0-beta.4'; // TODO: Initial version of plz debug

export class GoDebugConfigurationProvider
  implements vscode.DebugConfigurationProvider
{
  public async resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    debugConfiguration: vscode.DebugConfiguration,
    token?: vscode.CancellationToken
  ): Promise<vscode.DebugConfiguration> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return;
    }

    try {
      const repoRoot = plz.repoRoot();
      if (!repoRoot) {
        throw new Error('You need to be inside a Please repo for debugging.');
      }

      plz.ensureMinimumVersion(
        PLZ_GO_DEBUG_MIN_VERSION,
        `The minimum Please version for Go debugging is ${PLZ_GO_DEBUG_MIN_VERSION}`
      );

      // This is a `delve` configuration setting to get path mappings right.
      debugConfiguration.substitutePath = [
        // TODO: We need to be able to toggle between the configurations based on:
        // 1) Whether sandboxing is enabled or not.
        // 2) Location of toolchain used to be able load its sources if required during debugging.
        // We don't want the default substitute path, set below, to mess with this path.

        // TODO: This works when the toolchain used is defined in third_party is used
        {
          from: path.join(repoRoot, 'plz-out/bin/third_party'),
          to: path.join(repoRoot, 'plz-out/bin/third_party'),
        },
        {
          from: path.join(
            repoRoot,
            'plz-out/debug', // Top level directory that Please uses for preparing targets for debugging.
            plz.labelPackage(debugConfiguration.target),
            'third_party'
          ),
          to: 'third_party',
        },
        // Default substitute path.
        { from: repoRoot + '/', to: '' },
      ];

      debugConfiguration.plzBinPath =
        '/home/ttristao/code/please/plz-out/please/plz'; // TODO: plz.binPath()
      debugConfiguration.repoRoot = repoRoot;
    } catch (e) {
      vscode.window.showErrorMessage(e.message);
      return;
    }

    // Get the `Debug Console` panel focused since the `plz debug` command will
    // be executed within the adapter itself.
    vscode.commands.executeCommand('workbench.debug.action.focusRepl');

    return debugConfiguration;
  }
}
