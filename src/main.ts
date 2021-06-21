import * as vscode from "vscode";

import { GoDebugCodeLensProvider } from "./goDebugCodeLens";
import { GoDebugConfigurationProvider } from "./goDebugConfiguration";
import { startLanguageClient } from "./languageClient";
import * as plz from "./please";
import { debug } from "./goDebug";

export function activate(context: vscode.ExtensionContext) {
  // Ensure that Please is installed
  if (!plz.binPath()) {
    vscode.window.showErrorMessage(
      "Cannot find Please. Install it from https://github.com/thought-machine/please."
    );
    return undefined;
  }

  // Start language client
  context.subscriptions.push(startLanguageClient());

  // Setup Go debugging
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(
      "plz-go",
      new GoDebugConfigurationProvider("plz-go")
    )
  );
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: "go", scheme: "file" },
      new GoDebugCodeLensProvider()
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("plz-go.debug.package", async (args) => {
      if (vscode.debug.activeDebugSession) {
        vscode.window.showErrorMessage(
          "Debug session has already been initialised"
        );
        return undefined;
      }
      await debug(args.document);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("plz-go.debug.test", async (args) => {
      if (vscode.debug.activeDebugSession) {
        vscode.window.showErrorMessage(
          "Debug session has already been initialised"
        );
        return undefined;
      }
      await debug(args.document, args.functionName);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "plz-go.debug.pickTestTarget",
      async (args): Promise<string> => {
        return await vscode.window.showQuickPick(args.targets, {
          placeHolder: "Select the target associated with this test",
        });
      }
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "plz-go.debug.enterTestTarget",
      async (): Promise<string> => {
        return await vscode.window.showInputBox({
          placeHolder: "Enter test target to debug",
        });
      }
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "plz-go.debug.enterTestFunction",
      async (): Promise<string> => {
        return await vscode.window.showInputBox({
          placeHolder: "Enter test function to debug (optional)",
        });
      }
    )
  );
}
