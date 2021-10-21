import * as vscode from 'vscode';

// Good enough heuristic.
const PYTHON_TEST_FILENAME_REGEX = /^(test_.+|.+_test)\.py$/;

export class PythonTestCodeLensProvider implements vscode.CodeLensProvider {
  public async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    if (!PYTHON_TEST_FILENAME_REGEX.test(document.fileName)) {
      return [];
    }

    return await this.getCodeLens(document, token);
  }

  private async getCodeLens(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    // Ideally, we would include the whole file range but this just works fine and is easier.
    const range = new vscode.Range(
      new vscode.Position(0, 0),
      new vscode.Position(0, 1)
    );

    return [
      new vscode.CodeLens(range, {
        title: 'plz test',
        command: 'plz.test.document',
        arguments: [{ document }],
      }),
      new vscode.CodeLens(range, {
        title: 'plz debug',
        command: 'plz.debug.document',
        arguments: [{ document, language: 'python' }],
      }),
    ];
  }
}
