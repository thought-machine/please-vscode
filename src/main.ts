import { execFile } from 'child_process';
import * as vscode from 'vscode';

import {
  plzCommand,
  plzDebugDocumentCommand,
  plzDebugTargetCommand,
  plzTestDocumentCommand,
} from './commands';
import { startLanguageClient } from './languageClient';
import { LANGUAGE_DEBUG_IDS } from './languages/constants';
import { GoTestCodeLensProvider } from './languages/go/codeLensProvider';
import { GoDebugConfigurationProvider } from './languages/go/debugConfigurationProvider';
import { BuildFileCodeLensProvider } from './languages/plz/codeLensProvider';
import { PythonDebugAdapterDescriptorProvider } from './languages/python/debugAdapterDescriptorFactory';
import { PythonTestCodeLensProvider } from './languages/python/codeLensProvider';
import { PythonDebugConfigurationProvider } from './languages/python/debugConfigurationProvider';
import * as plz from './please';
import { getBinPath } from './utils/pathUtils';

export async function activate(context: vscode.ExtensionContext) {
  // Ensure that Please is installed
  if (!plz.binPath()) {
    vscode.window.showErrorMessage(
      'Cannot find Please. Get it from https://github.com/thought-machine/please.'
    );
    return;
  }

  // Start language client
  context.subscriptions.push(startLanguageClient());

  // Load Go env variables
  await loadGoEnvVariables();

  // Setup Go debugging
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(
      LANGUAGE_DEBUG_IDS.go,
      new GoDebugConfigurationProvider()
    )
  );
  // Setup Go codelenses
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'go', scheme: 'file' },
      new GoTestCodeLensProvider()
    )
  );

  // Setup Python debugging
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(
      LANGUAGE_DEBUG_IDS.python,
      new PythonDebugConfigurationProvider()
    )
  );
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory(
      LANGUAGE_DEBUG_IDS.python,
      new PythonDebugAdapterDescriptorProvider()
    )
  );
  // Setup Python codelenses
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'python', scheme: 'file' },
      new PythonTestCodeLensProvider()
    )
  );

  // Setup plz-related commands
  context.subscriptions.push(
    vscode.commands.registerCommand('plz.test.document', plzTestDocumentCommand)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'plz.debug.document',
      plzDebugDocumentCommand
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('plz.debug.target', plzDebugTargetCommand)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('plz', plzCommand)
  );

  // Set up BUILD file codelenses
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'plz', scheme: 'file' },
      new BuildFileCodeLensProvider()
    )
  );
}

export async function loadGoEnvVariables(): Promise<void> {
  const goBinPath = getBinPath('go');
  if (!goBinPath) {
    vscode.window.showInformationMessage(
      'Cannot find Go to load related environment variables.'
    );
    return;
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
