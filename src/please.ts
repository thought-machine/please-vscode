import * as fs from 'fs';
import * as path from 'path';

import {getBinPathFromEnvVar} from './utils/pathUtils';

export const PLZ_TOOL = 'plz';
export const PLZ_CONFIG = '.plzconfig';

export function getPleaseBinPath(): string | undefined {
    return getBinPathFromEnvVar(PLZ_TOOL, process.env['PATH'], false);
}

// Walks up the current directory until it finds the `.plzconfig` file
export function resolvePleaseRepoRoot(currentDirectory: string): string | undefined {
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
