import * as vscode from 'vscode';

import { getBinPathUsingConfig } from '../../utils';
import { documentSymbols } from './goOutline';

const TEST_FUNCTION_REGEX = /^Test\P{Ll}.*/u;
const TEST_METHOD_REGEX = /^\(([^)]+)\)\.(Test\P{Ll}.*)$/u;

export class GoTestCodeLensProvider implements vscode.CodeLensProvider {
  private goOutlineNotFoundMessageShown = false;

  public async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    if (!document.fileName.endsWith('_test.go')) {
      return [];
    }

    return await this.getCodeLens(document, token);
  }

  private async getCodeLens(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const goOutline = getBinPathUsingConfig('go-outline');
    if (!goOutline) {
      if (!this.goOutlineNotFoundMessageShown) {
        this.goOutlineNotFoundMessageShown = true;
        vscode.window.showWarningMessage(
          'Go Outline is required for providing code lenses in Go tests for debugging. Get it from https://github.com/ramya-rao-a/go-outline.'
        );
      }
      return;
    }

    const symbols = await documentSymbols(goOutline, document, token);
    if (!Array.isArray(symbols)) {
      return [];
    }

    const pkg = symbols[0];
    if (!pkg) {
      return [];
    }

    let codeLens: vscode.CodeLens[] = [
      new vscode.CodeLens(pkg.range, {
        title: 'plz test',
        command: 'plz.test.document',
        arguments: [{ document }],
      }),
      new vscode.CodeLens(pkg.range, {
        title: 'plz debug',
        command: 'plz.debug.document',
        arguments: [{ document, language: 'go' }],
      }),
    ];

    const testFunctions = pkg.children.filter(
      (sym) =>
        sym.kind === vscode.SymbolKind.Function &&
        (TEST_FUNCTION_REGEX.test(sym.name) || TEST_METHOD_REGEX.test(sym.name))
    );
    for (const fn of testFunctions) {
      const functionName = extractTestName(fn.name);

      codeLens = [
        ...codeLens,
        new vscode.CodeLens(fn.range, {
          title: 'plz test',
          command: 'plz.test.document',
          arguments: [{ document, functionName }],
        }),
        new vscode.CodeLens(fn.range, {
          title: 'plz debug',
          command: 'plz.debug.document',
          arguments: [{ document, functionName, language: 'go' }],
        }),
      ];
    }

    return codeLens;
  }
}

function extractTestName(symbolName: string): string {
  if (TEST_FUNCTION_REGEX.test(symbolName)) {
    return symbolName;
  } else if (TEST_METHOD_REGEX.test(symbolName)) {
    const match = symbolName.match(TEST_METHOD_REGEX);
    return `/${match[2]}`;
  }

  return '';
}
