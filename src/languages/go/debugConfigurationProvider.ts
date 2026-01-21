import { execFileSync } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

import * as plz from '../../please';
import { workspacePath } from '../../utils';
import { getBinPathFromEnvVar, executableFileExists } from '../../utils/pathUtils';

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
  const configFields = ['plugin.go.gotool', 'go.gotool'];
  // This is required since we load `GOROOT` onto `process.env` at the start
  // of the extension activation.
  const env = { ...process.env, GOROOT: '' }
  const buildPaths = plz.runCommand(['query', 'config', 'build.path']);

  for (const configField of configFields) {
    let goTool = plz.runCommand(['query', 'config', configField]);

    // Check whether it is a target.
    if (goTool.startsWith(':') || goTool.startsWith('//')) {
      try {
        return plz.runCommand(['run', goTool, '--', 'env', 'GOROOT'], true, env);
      } catch (error: unknown) {
        console.warn(`Failed to run ${configField} ${goTool} to get GOROOT`, {error});
      }
    }

    // Check if an absolute path
    if (executableFileExists(goTool)) {
      try {
        return execFileSync(goTool, ['env', 'GOROOT'], {env}).toString().trim();
      } catch (error: unknown) {
        console.warn(`Failed to run ${configField} ${goTool} to get GOROOT`, {error});
      }
    }

    // Check if the binary can be resolved on the Please (not system) path.
    // The build.path config field is actually a list, so we need to iterate over each entry.
    for (const buildPath of buildPaths.split('\n')) {
      const goToolPath = getBinPathFromEnvVar(goTool, buildPath, false);

      if (goToolPath) {
        try {
          return execFileSync(goToolPath, ['env', 'GOROOT'], {env}).toString().trim();
        } catch (error: unknown) {
          console.warn(`Failed to run ${configField} ${goTool} resolved as ${goToolPath} to get GOROOT`, {error});
        }
      }
    }
  }

  throw new Error('Unable to find the Go toolchain for this project.');
}
