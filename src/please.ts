import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';
import * as vscode from 'vscode';

import { getBinPath } from './utils/pathUtils';

export const TOOL_NAME = 'plz';
export const CONFIG_FILENAME = '.plzconfig';
export const BUILD_FILENAME_REGEX = /^BUILD(\.plz|\.build)?$/;
export const SANDBOX_DIRECTORY = '/tmp/plz_sandbox';

export function binPath(): string | undefined {
  return getBinPath(TOOL_NAME);
}

// Creates `Please` Output channel.
export const outputChannel = vscode.window.createOutputChannel('Please');

// Asynchronously runs a command where its progress is detailed on the `Please` Output channel.
export function spawnCommand(args: string[]): void {
  const plz = spawn(
    binPath(),
    ['--plain_output', '--verbosity=info', ...args],
    { cwd: repoRoot() || path.resolve('.') }
  );

  outputChannel.show(true);
  outputChannel.appendLine(`> Running command: ${binPath()} ${args.join(' ')}`);

  plz.stdout.on('data', (data) => outputChannel.appendLine(data));
  plz.stderr.on('data', (data) => outputChannel.appendLine(data));

  plz.on('error', (err) =>
    outputChannel.appendLine(`> Command error: ${err.message}`)
  );
  plz.on('close', (code) =>
    outputChannel.appendLine(`> Command terminated with ${code}`)
  );
}

// Runs a command with the intend of obtaining stdout. An error is throw if something fails.
export function runCommand(args: string[]): string {
  const plz = spawnSync(binPath(), args, {
    cwd: repoRoot() || path.resolve('.'),
  });

  if (plz.error) {
    throw plz.error;
  } else if (plz.status !== 0) {
    throw new Error(
      `${plz.stderr}\nCommand terminated with ${plz.status || plz.signal}`
    );
  }

  return plz.stdout.toString();
}

// Get version (i.e. `plz --version` => `Please version 16.1.0-beta.1` => `16.1.0-beta.1`).
export function version(): string {
  const versionOutput = runCommand(['--version']);

  const matches = versionOutput.match(/\d+\.\d+\.\d+\S*/);
  if (!matches) {
    throw new Error(`Could not parse Please version: ${versionOutput}`);
  }

  return matches[0];
}

// This exists to gatekeep functionality not available in lower versions.
export function ensureMinimumVersion(
  minVersion: string,
  explanation: string
): void {
  const currentVersion = version();

  if (semver.lt(currentVersion, minVersion)) {
    throw new Error(explanation);
  }
}

// Retrieves target(s) with specified file as a source.
export function inputTargets(filename: string): Array<string> {
  const repoPath = repoRoot() || path.resolve('.');

  if (filename.startsWith(repoPath)) {
    filename = filename.substring(repoPath.length + 1);
  }

  const targetsOutput = runCommand(['query', 'whatinputs', filename]);
  const targets = targetsOutput
    .split('\n')
    .filter((target) => target.startsWith(':') || target.startsWith('//'));

  return targets;
}

// Creates a build label based on a BUILD filename and rule label.
export function buildLabel(buildFilename: string, ruleLabel: string): string {
  const repo = repoRoot();
  if (repo && buildFilename.startsWith(repo)) {
    buildFilename = buildFilename.substring(repo.length + 1);
  }

  const pkg = path.dirname(buildFilename);

  return `//${pkg !== '.' ? pkg : ''}:${ruleLabel}`;
}

// Gets the package of a label.
export function labelPackage(label: string): string {
  let pkg = label;

  const colonPosition = pkg.indexOf(':');
  if (colonPosition !== -1) {
    pkg = pkg.substring(0, colonPosition);
  }

  if (pkg.startsWith(':')) {
    pkg = pkg.substring(':'.length);
  } else if (pkg.startsWith('//')) {
    pkg = pkg.substring('//'.length);
  }

  return pkg;
}

// Walks up the current directory until it finds the `.plzconfig` file.
export function repoRoot(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  let currentDirectory = path.dirname(editor.document.fileName);
  do {
    try {
      const status = fs.lstatSync(path.join(currentDirectory, CONFIG_FILENAME));
      if (status.isFile()) {
        return currentDirectory;
      }
    } catch (e) {}

    currentDirectory = path.dirname(currentDirectory);
  } while (currentDirectory !== '/');

  return undefined;
}
