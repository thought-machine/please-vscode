import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as semver from "semver";
import * as vscode from "vscode";

import { getBinPath } from "./utils/pathUtils";

export const PLZ_TOOL = "plz";
export const PLZ_CONFIG = ".plzconfig";

export function binPath(): string | undefined {
  return getBinPath(PLZ_TOOL);
}

// Get version (i.e. `plz --version` => `Please version 16.1.0-beta.1` => `16.1.0-beta.1`)
export async function version(): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile(
      binPath(),
      ["--version"],
      { cwd: repoRoot() || path.resolve(".") },
      (err, stdout) => {
        if (err) {
          return reject(err);
        }

        const matches = stdout.match(/\d+\.\d+\.\d+\S*/);
        if (!matches) {
          return reject(new Error(`Could not parse Please version: ${stdout}`));
        }

        return resolve(matches[0]);
      }
    );
  });
}

export async function ensureMinimumVersion(
  minVersion: string
): Promise<undefined> {
  if (semver.lt(await version(), minVersion)) {
    throw new Error(
      `You need to be at least on Please version ${minVersion}. Go to https://github.com/thought-machine/please to update it.`
    );
  }

  return undefined;
}

// Retrieves target(s) with specified file as a source
export async function getInputTargets(
  filename: string
): Promise<Array<string>> {
  const repoPath = repoRoot() || path.resolve(".");

  if (filename.startsWith(repoPath)) {
    filename = filename.substring(repoPath.length + 1);
  }

  return await new Promise((resolve, reject) => {
    execFile(
      binPath(),
      ["query", "whatinputs", filename],
      { cwd: repoPath },
      (err, stdout) => {
        if (err) {
          return reject(err);
        }

        const targets = stdout.split("\n").filter(Boolean);
        if (
          !targets.every(
            (target) => target.startsWith(":") || target.startsWith("//")
          )
        ) {
          return reject(
            new Error(`No targets found with file as source: ${filename}`)
          );
        }

        return resolve(targets);
      }
    );
  });
}

// Walks up the current directory until it finds the `.plzconfig` file
export function repoRoot(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  let currentDirectory = path.dirname(editor.document.fileName);
  do {
    try {
      const status = fs.lstatSync(path.join(currentDirectory, PLZ_CONFIG));
      if (status.isFile()) {
        return currentDirectory;
      }
    } catch (e) {}

    currentDirectory = path.dirname(currentDirectory);
  } while (currentDirectory !== "/");

  return undefined;
}
