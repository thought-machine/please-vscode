/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Modification copyright 2020 The Go Authors. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

/**
 * This file is loaded by both the extension and debug adapter, so it cannot import 'vscode'
 */
import * as fs from 'fs';
import * as path from 'path';

let binPathCache: { [bin: string]: string } = {};

export const envPath = process.env['PATH'] || (process.platform === 'win32' ? process.env['Path'] : null);

// find the tool's path from the given PATH env var, or null if the tool is not found.
export function getBinPathFromEnvVar(toolName: string, envVarValue: string, appendBinToPath: boolean): string | null {
	toolName = correctBinname(toolName);
	if (envVarValue) {
		const paths = envVarValue.split(path.delimiter);
		for (const p of paths) {
			const binpath = path.join(p, appendBinToPath ? 'bin' : '', toolName);
			if (executableFileExists(binpath)) {
				return binpath;
			}
		}
	}
	return null;
}

export function getBinPathWithPreferredGopathGoroot(
	toolName: string,
	preferredGopaths: string[],
	preferredGoroot?: string,
	alternateTool?: string,
	useCache = true
): string {
	const r = getBinPathWithPreferredGopathGorootWithExplanation(
		toolName,
		preferredGopaths,
		preferredGoroot,
		alternateTool,
		useCache
	);
	return r.binPath;
}

// Is same as getBinPathWithPreferredGopathGoroot, but returns why the
// returned path was chosen.
export function getBinPathWithPreferredGopathGorootWithExplanation(
	toolName: string,
	preferredGopaths: string[],
	preferredGoroot?: string,
	alternateTool?: string,
	useCache = true
): { binPath: string; why?: string } {
	if (alternateTool && path.isAbsolute(alternateTool) && executableFileExists(alternateTool)) {
		binPathCache[toolName] = alternateTool;
		return { binPath: alternateTool, why: 'alternateTool' };
	}

	// FIXIT: this cache needs to be invalidated when go.goroot or go.alternateTool is changed.
	if (useCache && binPathCache[toolName]) {
		return { binPath: binPathCache[toolName], why: 'cached' };
	}

	const binname = alternateTool && !path.isAbsolute(alternateTool) ? alternateTool : toolName;
	const found = (why: string) => (binname === toolName ? why : 'alternateTool');
	const pathFromGoBin = getBinPathFromEnvVar(binname, process.env['GOBIN'], false);
	if (pathFromGoBin) {
		binPathCache[toolName] = pathFromGoBin;
		return { binPath: pathFromGoBin, why: binname === toolName ? 'gobin' : 'alternateTool' };
	}

	for (const preferred of preferredGopaths) {
		if (typeof preferred === 'string') {
			// Search in the preferred GOPATH workspace's bin folder
			const pathFrompreferredGoPath = getBinPathFromEnvVar(binname, preferred, true);
			if (pathFrompreferredGoPath) {
				binPathCache[toolName] = pathFrompreferredGoPath;
				return { binPath: pathFrompreferredGoPath, why: found('gopath') };
			}
		}
	}

	// Check GOROOT (go, gofmt, godoc would be found here)
	const pathFromGoRoot = getBinPathFromEnvVar(binname, preferredGoroot || getCurrentGoRoot(), true);
	if (pathFromGoRoot) {
		binPathCache[toolName] = pathFromGoRoot;
		return { binPath: pathFromGoRoot, why: found('goroot') };
	}

	// Finally search PATH parts
	const pathFromPath = getBinPathFromEnvVar(binname, envPath, false);
	if (pathFromPath) {
		binPathCache[toolName] = pathFromPath;
		return { binPath: pathFromPath, why: found('path') };
	}

	// Check common paths for go
	if (toolName === 'go') {
		const defaultPathsForGo =
			process.platform === 'win32'
				? ['C:\\Program Files\\Go\\bin\\go.exe', 'C:\\Program Files (x86)\\Go\\bin\\go.exe']
				: ['/usr/local/go/bin/go', '/usr/local/bin/go'];
		for (const p of defaultPathsForGo) {
			if (executableFileExists(p)) {
				binPathCache[toolName] = p;
				return { binPath: p, why: 'default' };
			}
		}
		return { binPath: '' };
	}

	// Else return the binary name directly (this will likely always fail downstream)
	return { binPath: toolName };
}

/**
 * Returns the goroot path if it exists, otherwise returns an empty string
 */
export function getCurrentGoRoot(): string {
	return process.env['GOROOT'] || '';
}

export function correctBinname(toolName: string) {
	if (process.platform === 'win32') {
		return toolName + '.exe';
	}
	return toolName;
}

export function executableFileExists(filePath: string): boolean {
	let exists = true;
	try {
		exists = fs.statSync(filePath).isFile();
		if (exists) {
			fs.accessSync(filePath, fs.constants.F_OK | fs.constants.X_OK);
		}
	} catch (e) {
		exists = false;
	}
	return exists;
}

// Workaround for issue in https://github.com/Microsoft/vscode/issues/9448#issuecomment-244804026
export function fixDriveCasingInWindows(pathToFix: string): string {
	return process.platform === 'win32' && pathToFix
		? pathToFix.substr(0, 1).toUpperCase() + pathToFix.substr(1)
		: pathToFix;
}
