import * as vscode from 'vscode';

import { PLZ_DEBUG_MIN_VERSION } from './goDebugConfiguration';
import * as plz from './please';

export async function debug(document: vscode.TextDocument, functionName = '') {
    const debugConfig: vscode.DebugConfiguration = {
        type: 'plz-go',
        request: 'launch',
        name: 'Launch Go test',
    };

    try {
        const { fileName } = document;
        if (!fileName.endsWith('_test.go')) {
            throw new Error(`Not a test file: ${fileName}`);
        }

        await document.save();

        await plz.ensureMinimumVersion(PLZ_DEBUG_MIN_VERSION);

        const inputTargets = await plz.getInputTargets(fileName);
        if (inputTargets.length === 0) {
            throw new Error(`A target couldn't be found where the file is a source: ${fileName}`);
        }
        else if (inputTargets.length === 1) {
            debugConfig['target'] = inputTargets[0];
        }
        else {
            debugConfig['targets'] = inputTargets;
            debugConfig['target'] = '${command:pickTestTarget}';
        }

        debugConfig['test'] = functionName;
    } catch (e) {
        vscode.window.showErrorMessage(e.message);
        return undefined;
    }

    return await vscode.debug.startDebugging(undefined, debugConfig);
}
