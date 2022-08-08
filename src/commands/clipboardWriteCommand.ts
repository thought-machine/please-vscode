import * as clipboardy from 'clipboardy';
import * as vscode from 'vscode';

export function clipboardWriteCommand(args: {
  text: string;
  message?: string;
}): void {
  // Fallback to displaying the target onto the information box,
  // because access to the clipboard will be from the context
  // of the server when ssh'ing.
  if (process.env.SSH_CLIENT) {
    vscode.window.showInformationMessage(args.text);
    return;
  }

  clipboardy.writeSync(args.text);

  const message = args.message || `Copied onto the clipboard: '${args.text}`;
  vscode.window.showInformationMessage(message);
}
