import { execFileSync } from 'child_process';
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

// This gets activated only if the workspace contains a `.plzconfig` file.
// Check the `activationEvents` field in the `package.json` file.
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
  loadGoEnv();

  // Setup Go debugging
  try {
    plz.ensureMinVersion(
      '16.7.0',
      `This plugin version requires at least Please 16.7.0 for Go debugging.`
    );

    const goBinPath = getBinPath('go');
    if (!goBinPath) {
      throw new Error('Cannot find Go required for debugging support.');
    }

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
  } catch (e) {
    vscode.window.showWarningMessage(e.message);
  }

  // Setup Python debugging
  try {
    plz.ensureMinVersion(
      '16.7.0',
      `The minimum Please version for Python debugging is 16.7.0`
    );

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
  } catch (e) {
    vscode.window.showWarningMessage(e.message);
  }

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

// Loads Go-related environment variables onto `process.env`.
export function loadGoEnv(): void {
  try {
    const output = execFileSync(
      getBinPath('go'),
      ['env', '-json', 'GOPATH', 'GOROOT', 'GOBIN'],
      { encoding: 'utf-8' }
    );

    const envOutput = JSON.parse(output.toString());
    for (const envName in envOutput) {
      if (!process.env[envName] && envOutput[envName]?.trim()) {
        process.env[envName] = envOutput[envName].trim();
      }
    }
  } catch (e) {
    throw new Error(
      `Failed to run Go to load related environment variables:\n${e.message}`
    );
  }
}
