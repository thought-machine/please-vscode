import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';
import * as vscode from 'vscode';

import { getBinPathFromEnvVar } from './utils/pathUtils';

const PLZ_MIN_VERSION = '16.1.0-beta.1';

export class GoDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    constructor(private plzBinPath: string = 'plz') { }

    public async resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        debugConfiguration: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration> {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return undefined;
        }

        // Attempt to get current Please version
        // i.e. `plz --version` => `Please version 16.1.0-beta.1` => `16.1.0-beta.1`
        const currentPlzVersion = await new Promise<string | null>((resolve) => {
            execFile(this.plzBinPath, ['--version'], (err, stdout) => {
                if (err) return resolve(null);
                const matches = stdout.match(/\d+\.\d+\.\d+\S*/);
                return resolve(matches && matches[0])
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

        debugConfiguration['plzBinPath'] = this.plzBinPath;

        // Ensure that Delve is installed
        const dlvBinPath = getDelveBinPath();
        if (!dlvBinPath) {
            vscode.window.showErrorMessage(
                'Cannot find Delve debugger. Install from https://github.com/go-delve/delve and ensure it is in your Go tools path, "GOPATH/bin" or "PATH".'
            )
            return undefined;
        }
        debugConfiguration['dlvBinPath'] = dlvBinPath;

        return debugConfiguration;
    }
}

function getDelveBinPath(): string | undefined {
    const dlvTool = 'dlv';

    return getBinPathFromEnvVar(dlvTool, process.env['GOPATH'], true) || getBinPathFromEnvVar(dlvTool, process.env['PATH'], false)
}

// Walks up the current directory until it finds a `.plzconfig` file
function resolvePleaseRepoRoot(currentDirectory: string): string | undefined {
    const PLZ_CONFIG = '.plzconfig';

    do {
        try {
            const status = fs.lstatSync(path.join(currentDirectory, PLZ_CONFIG));
            if (status.isFile()) {
                return currentDirectory;
            }
        } catch (e) { }

        currentDirectory = path.dirname(currentDirectory)
    } while (currentDirectory !== '/');

    return undefined;
}
