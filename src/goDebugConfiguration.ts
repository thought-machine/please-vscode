import { execFile } from 'child_process';
import * as path from 'path';
import * as semver from 'semver';
import * as vscode from 'vscode';

import { getBinPathFromEnvVar } from './utils/pathUtils';
import {getPleaseBinPath, resolvePleaseRepoRoot} from './please';

const PLZ_MIN_VERSION = '16.1.0-beta.1';

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
                    name: 'Launch test target',
                    type: this.debugType,
                    request: 'launch',
                    target: '${command:setTestTarget}',
                    test: '${command:setTestFunction}',
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

        const plzBinPath = getPleaseBinPath();

        // Attempt to get current Please version
        // i.e. `plz --version` => `Please version 16.1.0-beta.1` => `16.1.0-beta.1`
        const currentPlzVersion = await new Promise<string | null>((resolve) => {
            execFile(plzBinPath, ['--version'], (err, stdout) => {
                if (err) return resolve(null);
                const matches = stdout.match(/\d+\.\d+\.\d+\S*/);
                return resolve(matches && matches[0]);
            });
        });

        // If the current Please version is available, ensure it is up-to-date
        if (currentPlzVersion && semver.lt(currentPlzVersion, PLZ_MIN_VERSION)) {
            vscode.window.showErrorMessage(
                `You need to be at least on Please version ${PLZ_MIN_VERSION}. Go to https://github.com/thought-machine/please to update it.`
            )
            return undefined;
        }

        // Walk up the directory tree to the Please repo root
        const plzRepoRoot = resolvePleaseRepoRoot(path.dirname(activeEditor.document.fileName));
        if (!plzRepoRoot) {
            vscode.window.showErrorMessage('You need to be inside a Please repo.')
            return undefined;
        }
        debugConfiguration['repoRoot'] = plzRepoRoot;

        debugConfiguration['plzBinPath'] = plzBinPath;

        // Ensure that Delve is installed
        const dlvBinPath = getDelveBinPath();
        if (!dlvBinPath) {
            vscode.window.showErrorMessage('Cannot find Delve debugger. Install from https://github.com/go-delve/delve.');
            return undefined;
        }
        debugConfiguration['dlvBinPath'] = dlvBinPath;

        // Get the `Debug Console` panel focused
        vscode.commands.executeCommand('workbench.debug.action.focusRepl');

        return debugConfiguration;
    }
}

function getDelveBinPath(): string | undefined {
    const dlvTool = 'dlv';

    return getBinPathFromEnvVar(dlvTool, process.env['GOPATH'], true) || getBinPathFromEnvVar(dlvTool, process.env['PATH'], false)
}

