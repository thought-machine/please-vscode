import * as path from 'path';
import * as vscode from 'vscode';

import * as plz from '../../please';
import { workspacePath } from '../../utils';

// Default explode location by the PEX tool for debuggable PEX files.
const RELATIVE_PEX_EXPLODE_LOCATION = '.cache/pex/pex-debug';

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
      if (!debugConfiguration.target) {
        throw new Error('No target acquired for debugging.');
      }

      const repoRoot = workspacePath();

      const isTargetSandboxed = plz.isSandboxTarget(debugConfiguration.target);
      const localExplodeLocation = path.join(
        repoRoot,
        plz.DEBUG_OUT_DIRECTORY,
        plz.labelPackage(debugConfiguration.target),
        RELATIVE_PEX_EXPLODE_LOCATION
      );
      const sandboxExplodeLocation = path.join(
        plz.SANDBOX_DIRECTORY,
        RELATIVE_PEX_EXPLODE_LOCATION
      );

      // This is a `debugpy` configuration setting to get path mappings right.
      debugConfiguration.pathMappings = isTargetSandboxed
        ? [
            // Third party
            {
              localRoot: path.join(localExplodeLocation, 'third_party'),
              remoteRoot: path.join(sandboxExplodeLocation, 'third_party'),
            },
            // Sources
            {
              localRoot: repoRoot,
              remoteRoot: path.join(sandboxExplodeLocation),
            },
          ]
        : [
            // Third party
            {
              localRoot: path.join(localExplodeLocation, 'third_party'),
              remoteRoot: path.join(localExplodeLocation, 'third_party'),
            },
            // Sources
            {
              localRoot: repoRoot,
              remoteRoot: localExplodeLocation,
            },
          ];
    } catch (e) {
      vscode.window.showErrorMessage(e.message);
      return;
    }

    return debugConfiguration;
  }
}
