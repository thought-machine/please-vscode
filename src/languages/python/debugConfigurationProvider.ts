import * as path from 'path';
import * as vscode from 'vscode';

import * as plz from '../../please';

const PLZ_PYTHON_DEBUG_MIN_VERSION = '16.1.0-beta.4'; // TODO: Please version including debugpy in please_pex

export class PythonDebugConfigurationProvider
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
      } else if (!debugConfiguration.target) {
        throw new Error('No target acquired for debugging.');
      }

      plz.ensureMinimumVersion(
        PLZ_PYTHON_DEBUG_MIN_VERSION,
        `The minimum Please version for Python debugging is ${PLZ_PYTHON_DEBUG_MIN_VERSION}`
      );

      // This is a `debugpy` configuration setting to get path mappings right.
      debugConfiguration.pathMappings = [
        // TODO: We need to be able to toggle between the configurations based on whether the build/test is sandboxed or not.
        //{
          //localRoot: repoRoot,
          //remoteRoot: path.join(
            //plz.SANDBOX_DIRECTORY,
            //'.cache/pex/pex-debug' // This is the directory that please_pex uses for extracting the pex.
          //),
        //},
        {
          localRoot: repoRoot,
          remoteRoot: path.join(
            repoRoot,
            'plz-out/debug', // Top level directory that Please uses for preparing targets for debugging.
            plz.labelPackage(debugConfiguration.target),
            '.cache/pex/pex-debug' // This is the directory that please_pex uses for extracting the pex.
          ),
        },
      ];
    } catch (e) {
      vscode.window.showErrorMessage(e.message);
      return;
    }

    return debugConfiguration;
  }
}
