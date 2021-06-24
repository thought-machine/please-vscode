import { execFile } from 'child_process';
import * as vscode from 'vscode';

import {
  checkGoDebugCodeLensSupport,
  GoDebugCodeLensProvider,
} from './goDebugCodeLens';
import { GoDebugConfigurationProvider } from './goDebugConfiguration';
import { startLanguageClient } from './languageClient';
import * as plz from './please';
import { debug } from './goDebug';
import { getBinPath } from './utils/pathUtils';

export async function activate(context: vscode.ExtensionContext) {
  // Ensure that Please is installed
  if (!plz.binPath()) {
    vscode.window.showErrorMessage(
      'Cannot find Please. Install it from https://github.com/thought-machine/please.'
    );
    return undefined;
  }

  // Start language client
  context.subscriptions.push(startLanguageClient());

  // Load Go env variables
  await loadGoEnvVariables();

  // Setup Go debugging
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(
      'plz-go',
      new GoDebugConfigurationProvider('plz-go')
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'plz-go.debug.enterTestTarget',
      async (): Promise<string> => {
        return await vscode.window.showInputBox({
          placeHolder: 'Enter test target to debug',
        });
      }
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'plz-go.debug.enterTestFunction',
      async (): Promise<string> => {
        return await vscode.window.showInputBox({
          placeHolder: 'Enter test function to debug (optional)',
        });
      }
    )
  );

  // Setup code lenses in Go tests for debugging
  if (checkGoDebugCodeLensSupport()) {
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider(
        { language: 'go', scheme: 'file' },
        new GoDebugCodeLensProvider()
      )
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('plz-go.debug.package', async (args) => {
        if (vscode.debug.activeDebugSession) {
          vscode.window.showErrorMessage(
            'Debug session has already been initialised'
          );
          return undefined;
        }
        await debug(args.document);
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('plz-go.debug.test', async (args) => {
        if (vscode.debug.activeDebugSession) {
          vscode.window.showErrorMessage(
            'Debug session has already been initialised'
          );
          return undefined;
        }
        await debug(args.document, args.functionName);
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'plz-go.debug.pickTestTarget',
        async (args): Promise<string> => {
          return await vscode.window.showQuickPick(args.targets, {
            placeHolder: 'Select the target associated with this test',
          });
        }
      )
    );
  }
}

export async function loadGoEnvVariables(): Promise<void> {
  const goBinPath = getBinPath('go');
  if (!goBinPath) {
    vscode.window.showInformationMessage(
      'Cannot find Go to load related environment variables.'
    );
    return undefined;
  }

  return new Promise<void>((resolve) => {
    execFile(
      goBinPath,
      // -json is supported since go1.9
      ['env', '-json', 'GOPATH', 'GOROOT', 'GOBIN'],
      { env: process.env, cwd: plz.repoRoot() },
      (err, stdout, stderr) => {
        if (err) {
          vscode.window.showErrorMessage(
            `Failed to run '${goBinPath} env. The config change may not be applied correctly.`
          );
          return resolve();
        }
        if (stderr) {
          // 'go env' may output warnings about potential misconfiguration.
          // Show the messages to users but keep processing the stdout.
          vscode.window.showWarningMessage(`'${goBinPath} env': ${stderr}`);
        }

        const envOutput = JSON.parse(stdout);
        for (const envName in envOutput) {
          if (!process.env[envName] && envOutput[envName]?.trim()) {
            process.env[envName] = envOutput[envName].trim();
          }
        }

        return resolve();
      }
    );
  });
}
