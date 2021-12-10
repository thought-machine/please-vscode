import { spawnSync } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

import * as plz from '../../please';
import { workspacePath } from '../../utils';
import { getBinPathFromEnvVar } from '../../utils/pathUtils';

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
      const repoRoot = workspacePath();
      const toolchainPath = goToolchainPath();

      // This is a `delve` configuration setting to get path mappings right.
      debugConfiguration.substitutePath = [
        // Toolchain
        {
          from: toolchainPath,
          to: toolchainPath,
        },
        // Third party
        {
          from: path.join(
            repoRoot,
            plz.DEBUG_OUT_DIRECTORY,
            plz.labelPackage(debugConfiguration.target),
            'third_party'
          ),
          to: 'third_party',
        },
        // Sources
        { from: repoRoot + '/', to: '' },
      ];

      const plzCmd = plz.cmd();
      debugConfiguration.plzBinPath = plzCmd.bin;
      debugConfiguration.plzBinArgs = plzCmd.args;

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

export function goToolchainPath(): string {
  let goTool = plz.runCommand(['query', 'config', 'go.gotool']);

  // TODO: Utility for this?
  if (goTool.startsWith(':') || goTool.startsWith('//')) {
    // Deals with annotated labels.
    if (goTool.includes('|')) {
      goTool = goTool.substring(0, goTool.indexOf('|'));
    }

    const goToolPath = plz.runCommand(['query', 'output', goTool]);

    return path.join(workspacePath(), goToolPath);
  }

  const buildPaths = plz.runCommand(['query', 'config', 'build.path']);

  for (const buildPath of buildPaths.split('\n')) {
    for (const buildPathPart of buildPath.split(':')) {
      const goToolPath = getBinPathFromEnvVar(goTool, buildPathPart, false);

      if (goToolPath) {
        const proc = spawnSync(goToolPath, ['env', 'GOROOT'], {
          // TODO
          env: { ...process.env, GOROOT: '' },
        });

        // TODO error handling

        return proc.stdout.toString().trim();
      }
    }
  }

  throw new Error('Unable to find the Go toolchain for this project.');
}
