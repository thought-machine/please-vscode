import * as vscode from 'vscode';

import { GoDebugCodeLensProvider } from './goDebugCodeLens';
import { startLanguageClient } from './languageClient';
import * as plz from './please';
import { debug } from './goDebug';

export function activate(context: vscode.ExtensionContext) {
	// Ensure that Please is installed
	if (!plz.binPath()) {
		vscode.window.showErrorMessage('Cannot find Please. Install it from https://github.com/thought-machine/please.');
		return undefined;
	}

	// Start language client
	context.subscriptions.push(startLanguageClient());

	// Setup Go debugging
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider({ language: 'go', scheme: 'file' }, new GoDebugCodeLensProvider())
	);
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'plz-go.debug.chooseTestTarget',
			async (args): Promise<string> => {
				return await vscode.window.showQuickPick(args.targets, { placeHolder: 'Select the target associated with this test' });
			}
		)
	);
	let debugInitialised = false;
	context.subscriptions.push(
		vscode.debug.onDidTerminateDebugSession(() => debugInitialised = false)
	);
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'plz-go.debug.package',
			async (args) => {
				try {
					if (debugInitialised || vscode.debug.activeDebugSession) {
						throw new Error('Debug session has already been initialised');
					}
					debugInitialised = true;
					await debug(args.document);
				}
				catch (e) {
					debugInitialised = false;
					vscode.window.showErrorMessage(e.message);
				}
			}
		)
	);
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'plz-go.debug.test',
			async (args) => {
				try {
					if (debugInitialised || vscode.debug.activeDebugSession) {
						throw new Error('Debug session has already been initialised');
					}
					debugInitialised = true;
					await debug(args.document, args.functionName);
				}
				catch (e) {
					debugInitialised = false;
					vscode.window.showErrorMessage(e.message);
				}
			}
		)
	);
}

