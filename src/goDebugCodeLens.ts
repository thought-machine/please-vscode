import * as vscode from 'vscode';

import { documentSymbols, getGoOutlineBinPath } from './goOutline';

const TEST_FUNCTION_REGEX = /^Test\P{Ll}.*/u;
const TEST_METHOD_REGEX = /^\(([^)]+)\)\.(Test\P{Ll}.*)$/u;

export class GoDebugCodeLensProvider implements vscode.CodeLensProvider {
  public async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    if (!document.fileName.endsWith('_test.go')) {
      return [];
    }

    if (!getGoOutlineBinPath()) {
      vscode.window.showErrorMessage(
        'Cannot find Go Outline. Install it from https://github.com/ramya-rao-a/go-outline.'
      );
      return [];
    }

    return await this.getCodeLens(document, token);
  }

  private async getCodeLens(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const symbols = await documentSymbols(document, token);
    if (!Array.isArray(symbols)) {
      return [];
    }

    const pkg = symbols[0];
    if (!pkg) {
      return [];
    }

    const codeLens: vscode.CodeLens[] = [];
    codeLens.push(
      new vscode.CodeLens(pkg.range, {
        title: 'plz test/debug package',
        command: 'plz-go.debug.package',
        arguments: [{ document }],
      })
    );

    const testFunctions = pkg.children.filter(
      (sym) =>
        sym.kind === vscode.SymbolKind.Function &&
        (TEST_FUNCTION_REGEX.test(sym.name) || TEST_METHOD_REGEX.test(sym.name))
    );
    for (const fn of testFunctions) {
      codeLens.push(
        new vscode.CodeLens(fn.range, {
          title: 'plz run/debug test',
          command: 'plz-go.debug.test',
          arguments: [{ document, functionName: extractTestName(fn.name) }],
        })
      );
    }

    return codeLens;
  }
}

function extractTestName(symbolName: string): string {
  if (TEST_FUNCTION_REGEX.test(symbolName)) {
    return symbolName;
  } else if (TEST_METHOD_REGEX.test(symbolName)) {
    const match = symbolName.match(TEST_METHOD_REGEX);
    return match[2];
  }

  return '';
}
