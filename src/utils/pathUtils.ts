/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Modification copyright 2020 The Go Authors. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

/**
 * This file is loaded by both the extension and debug adapter, so it cannot import 'vscode'
 */
import * as fs from "fs";
import * as path from "path";

let binPathCache: { [bin: string]: string } = {};

export const envPath =
  process.env["PATH"] ||
  (process.platform === "win32" ? process.env["Path"] : null);

// find the tool's path from the given PATH env var, or null if the tool is not found.
export function getBinPathFromEnvVar(
  toolName: string,
  envVarValue: string,
  appendBinToPath: boolean
): string | null {
  toolName = correctBinname(toolName);
  if (envVarValue) {
    const paths = envVarValue.split(path.delimiter);
    for (const p of paths) {
      const binpath = path.join(p, appendBinToPath ? "bin" : "", toolName);
      if (executableFileExists(binpath)) {
        return binpath;
      }
    }
  }
  return null;
}

export function getBinPath(
  toolName: string,
  useCache = true
): string | undefined {
  // FIXIT: this cache needs to be invalidated when go.goroot or go.alternateTool is changed.
  if (useCache && binPathCache[toolName]) {
    return binPathCache[toolName];
  }

  const binname = toolName;
  const pathFromGoBin = getBinPathFromEnvVar(
    binname,
    process.env["GOBIN"],
    false
  );
  if (pathFromGoBin) {
    binPathCache[toolName] = pathFromGoBin;
    return pathFromGoBin;
  }

  // Check GOROOT (go, gofmt, godoc would be found here)
  const pathFromGoRoot = getBinPathFromEnvVar(
    binname,
    getCurrentGoRoot(),
    true
  );
  if (pathFromGoRoot) {
    binPathCache[toolName] = pathFromGoRoot;
    return pathFromGoRoot;
  }

  // Finally search PATH parts
  const pathFromPath = getBinPathFromEnvVar(binname, envPath, false);
  if (pathFromPath) {
    binPathCache[toolName] = pathFromPath;
    return pathFromPath;
  }

  // Check common paths for go
  if (toolName === "go") {
    const defaultPathsForGo =
      process.platform === "win32"
        ? [
            "C:\\Program Files\\Go\\bin\\go.exe",
            "C:\\Program Files (x86)\\Go\\bin\\go.exe",
          ]
        : ["/usr/local/go/bin/go", "/usr/local/bin/go"];
    for (const p of defaultPathsForGo) {
      if (executableFileExists(p)) {
        binPathCache[toolName] = p;
        return p;
      }
    }
  }

  return undefined;
}

/**
 * Returns the goroot path if it exists, otherwise returns an empty string
 */
export function getCurrentGoRoot(): string {
  return process.env["GOROOT"] || "";
}

export function correctBinname(toolName: string) {
  if (process.platform === "win32") {
    return toolName + ".exe";
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
  return process.platform === "win32" && pathToFix
    ? pathToFix.substr(0, 1).toUpperCase() + pathToFix.substr(1)
    : pathToFix;
}
