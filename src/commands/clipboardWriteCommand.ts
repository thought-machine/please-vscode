import * as clipboardy from 'clipboardy';
import * as vscode from 'vscode';

export function clipboardWriteCommand(args: {
  text: string;
  message?: string;
}): void {
  clipboardy.writeSync(args.text);

  const message = args.message || `Copied onto the clipboard: '${args.text}`;
  vscode.window.showInformationMessage(message);
}
