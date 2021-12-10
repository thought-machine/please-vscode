import * as vscode from 'vscode';

import { getBinPath } from './utils/pathUtils';

export function workspacePath(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(
    editor.document.uri
  );

  return workspaceFolder?.uri.path;
}

export function getBinPathUsingConfig(toolName: string): string | undefined {
  const config = vscode.workspace.getConfiguration();
  const goPath = config.get<string>('go.gopath');

  return getBinPath(
    toolName,
    goPath ? [goPath, process.env['GOPATH']] : undefined
  );
}

export function random(low: number, high: number): number {
  return Math.floor(Math.random() * (high - low) + low);
}
