import * as vscode from 'vscode';

import { GoDebugConfigurationProvider } from './goDebugConfiguration';
import { startLanguageServer } from './languageServer';
import { getBinPathFromEnvVar } from './utils/pathUtils'

export function activate(context: vscode.ExtensionContext) {
	// Ensure that Please is installed
	const plzBinPath = getPleaseBinPath();
	if (!plzBinPath) {
		vscode.window.showErrorMessage(
			'Cannot find Please. Install from https://github.com/thought-machine/please and ensure it is in the "PATH" environment variable.'
		)
		return undefined;
	}

	// Start language server
	startLanguageServer(context);

	// Setup Go debugging
	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider('plz-go', new GoDebugConfigurationProvider(plzBinPath))
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'plz-go.debug.setTestTarget',
			async (): Promise<string> => {
				return await vscode.window.showInputBox({ placeHolder: 'Enter test target to debug' });
			}
		)
	);
}

function getPleaseBinPath(): string | undefined {
	return getBinPathFromEnvVar('plz', process.env['PATH'], false)
}
