import * as vscode from 'vscode';

import { GoDebugConfigurationProvider } from './goDebugConfiguration';
import { startLanguageClient } from './languageClient';
import { getPleaseBinPath } from './please';

export function activate(context: vscode.ExtensionContext) {
	// Ensure that Please is installed
	const plzBinPath = getPleaseBinPath();
	if (!plzBinPath) {
		vscode.window.showErrorMessage('Cannot find Please. Install from https://github.com/thought-machine/please.');
		return undefined;
	}
	
	// Start language client
	context.subscriptions.push(startLanguageClient());

	// Setup Go debugging
	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider('plz-go', new GoDebugConfigurationProvider('plz-go'))
	)
	let previousTestTarget = '';
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'plz-go.debug.setTestTarget',
			async (): Promise<string> => {
				const testTarget = await vscode.window.showInputBox({ value: previousTestTarget, placeHolder: 'Enter test target to debug' });
				if (testTarget !== undefined) {
					previousTestTarget = testTarget;
				}
				return testTarget;
			}
		)
	);
	let previousTestFunction = '';
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'plz-go.debug.setTestFunction',
			async (): Promise<string> => {
				const testFunction = await vscode.window.showInputBox({ value: previousTestFunction, placeHolder: 'Enter test function to debug (optional)' });
				if (testFunction !== undefined) {
					previousTestFunction = testFunction;
				}
				return testFunction;
			}
		)
	);
}

