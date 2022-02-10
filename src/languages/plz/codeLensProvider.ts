import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

import { DEBUGGABLE_LANGUAGE_RULES } from '../constants';
import * as plz from '../../please';
import { getBinPathUsingConfig } from '../../utils';

// Rule call item structure returned by `scripts/rule_calls.py`.
interface RuleCall {
  id: string;
  name: string;
  line: number;
}

export class BuildFileCodeLensProvider implements vscode.CodeLensProvider {
  private python3NotFoundMessageShown = false;

  public async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    if (!plz.BUILD_FILENAME_REGEX.test(path.basename(document.fileName))) {
      return [];
    }

    return await this.getCodeLenses(document, token);
  }

  private async getCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const python3 = getBinPathUsingConfig('python3');
    if (!python3) {
      if (!this.python3NotFoundMessageShown) {
        this.python3NotFoundMessageShown = true;
        vscode.window.showWarningMessage(
          'Cannot find python3 required for adding code lenses to BUILD files.'
        );
      }
      return;
    }

    let ruleCalls: RuleCall[];
    try {
      const content = await getRuleCalls(python3, document.getText());
      ruleCalls = JSON.parse(content);
    } catch (e) {
      plz.outputChannel.appendLine(
        `Error placing codelenses on '${document.fileName}': ${e.message}`
      );
      return;
    }

    const codeLens: vscode.CodeLens[] = [];
    for (const call of ruleCalls) {
      const { id: ruleName, name: ruleLabel, line } = call;
      const target = plz.buildLabel(document.fileName, ruleLabel);

      // Get line range.
      const range = new vscode.Range(
        new vscode.Position(line - 1, 0),
        new vscode.Position(line - 1, 0)
      );

      // Copies the target onto the clipboard.
      codeLens.push(
        new vscode.CodeLens(range, {
          title: '📋',
          command: 'clipboard.write',
          arguments: [
            {
              text: target,
              message: `Target copied onto the clipboard: ${target}`,
            },
          ],
        })
      );

      // Not all rules are buildable and since we don't have enough
      // information, this guarantees nothing is missed.
      codeLens.push(
        new vscode.CodeLens(range, {
          title: 'plz build',
          command: 'plz',
          arguments: [{ command: 'build', args: [target] }],
        })
      );

      // This check might not always be true but it is enough for now.
      if (ruleName.endsWith('_binary')) {
        codeLens.push(
          new vscode.CodeLens(range, {
            title: 'plz run',
            command: 'plz',
            arguments: [{ command: 'run', args: [target], runtime: true }],
          })
        );
      }
      // This check might not always be true but it is enough for now.
      else if (ruleName.endsWith('_test')) {
        codeLens.push(
          new vscode.CodeLens(range, {
            title: 'plz test',
            command: 'plz',
            arguments: [{ command: 'test', args: ['--rerun', target] }],
          })
        );
      }

      if (
        Object.prototype.hasOwnProperty.call(
          DEBUGGABLE_LANGUAGE_RULES,
          ruleName
        )
      ) {
        codeLens.push(
          new vscode.CodeLens(range, {
            title: 'plz debug',
            command: 'plz.debug.target',
            arguments: [
              { target, language: DEBUGGABLE_LANGUAGE_RULES[ruleName] },
            ],
          })
        );
      }
    }

    return codeLens;
  }
}

async function getRuleCalls(
  python3Path: string,
  buildFileContents: string
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const proc = execFile(
      python3Path,
      [path.join(__dirname, '../../../scripts/rule_calls.py')],
      { encoding: 'utf-8' },
      (err, stdout, stderr) => {
        if (err || stderr) {
          return reject(err || stderr);
        }
        resolve(stdout);
      }
    );
    proc.stdin.end(buildFileContents);
  });
}
