import * as vscode from 'vscode';
import * as clipboardy from 'clipboardy';

export function clipboardWriteCommand(args: {
  text: string;
  message?: string;
}): void {
  clipboardy.writeSync(args.text);

  const message = args.message ?? `Copied onto the clipboard: '${args.text}`;
  vscode.window.showInformationMessage(message);
}
