import * as semver from 'semver';
import * as vscode from 'vscode';

import * as plz from './please';
import { getBinPath } from './utils/pathUtils';

const PLZ_MIN_VERSION = '16.1.0-beta.4';

const outputChannel = vscode.window.createOutputChannel('Please Go Tests');

export async function debug(document: vscode.TextDocument, functionName = '') {
    const { fileName } = document;
    if (!fileName.endsWith('_test.go')) {
        throw new Error(`Not a test file: ${fileName}`);
    }

    await document.save();

    outputChannel.clear();
    outputChannel.appendLine('Starting up tests:')
    outputChannel.show();

    const debugConfig: vscode.DebugConfiguration = {
        type: 'plz-go',
        request: 'launch',
        name: 'Launch test',
    };

    outputChannel.appendLine('Getting Please version...');
    if (semver.lt(await plz.version(), PLZ_MIN_VERSION)) {
        throw new Error(`You need to be at least on Please version ${PLZ_MIN_VERSION}. Go to https://github.com/thought-machine/please to update it.`);
    }

    debugConfig['plzBinPath'] = plz.binPath();

    const dlvBinPath = getBinPath('dlv');
    if (!dlvBinPath) {
        throw new Error('Cannot find Delve debugger. Install it from https://github.com/go-delve/delve.');
    }
    debugConfig['dlvBinPath'] = dlvBinPath;

    const plzRepoRoot = plz.repoRoot();
    if (!plzRepoRoot) {
        throw new Error('You need to be inside a Please repo.')
    }
    debugConfig['repoRoot'] = plzRepoRoot;

    outputChannel.appendLine('Fetching test targets...');
    const inputTargets = await plz.getInputTargets(fileName);
    if (inputTargets.length === 0) {
        throw new Error(`A target couldn't be found where the file is a source: ${fileName}`);
    }
    else if (inputTargets.length === 1) {
        debugConfig['target'] = inputTargets[0];
    }
    else {
        debugConfig['targets'] = inputTargets;
        debugConfig['target'] = '${command:chooseTestTarget}';
    }

    debugConfig['test'] = functionName;

    // Get the `Debug Console` panel focused
    vscode.commands.executeCommand('workbench.debug.action.focusRepl');

    return await vscode.debug.startDebugging(undefined, debugConfig);
}
