import * as vscode from 'vscode';

import { getBinPath } from './utils/pathUtils';

export function getBinPathUsingConfig(toolName: string): string | undefined {
  const config = vscode.workspace.getConfiguration();
  const goPath = config.get<string>('go.gopath');

  return getBinPath(
    toolName,
    goPath ? [goPath, process.env['GOPATH']] : undefined
  );
}
