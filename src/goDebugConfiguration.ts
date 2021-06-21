import * as vscode from 'vscode';

import { getBinPath } from './utils/pathUtils';
import * as plz from './please';

export const PLZ_DEBUG_MIN_VERSION = '16.1.0-beta.4';

export class GoDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    constructor(private debugType: string) { }

    public async provideDebugConfigurations(
        folder: vscode.WorkspaceFolder | undefined,
        token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration[]> {
        const debugConfigurations = [
            {
                label: 'Please: Launch Go test target',
                description: 'Debug a test target',
                config: {
                    name: 'Launch Go test target',
                    type: this.debugType,
                    request: 'launch',
                    target: '${command:enterTestTarget}',
                    test: '${command:enterTestFunction}',
                }
            }
        ];

        const choice = await vscode.window.showQuickPick(debugConfigurations, {
            placeHolder: 'Choose debug configuration'
        });

        return choice ? [choice.config] : [];
    }

    public async resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        debugConfiguration: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration> {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return undefined;
        }

        try {
            await plz.ensureMinimumVersion(PLZ_DEBUG_MIN_VERSION);

            debugConfiguration['plzBinPath'] = plz.binPath();

            const dlvBinPath = getBinPath('dlv');
            if (!dlvBinPath) {
                throw new Error('Cannot find Delve debugger. Install it from https://github.com/go-delve/delve.');
            }
            debugConfiguration['dlvBinPath'] = dlvBinPath;

            const plzRepoRoot = plz.repoRoot();
            if (!plzRepoRoot) {
                throw new Error('You need to be inside a Please repo.')
            }
            debugConfiguration['repoRoot'] = plzRepoRoot;
        } catch (e) {
            vscode.window.showErrorMessage(e.message);
            return undefined;
        }

        // Get the `Debug Console` panel focused
        vscode.commands.executeCommand('workbench.debug.action.focusRepl');

        return debugConfiguration;
    }
}

