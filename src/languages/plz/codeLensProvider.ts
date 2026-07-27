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

      const customLenses = getCustomCodeLenses(ruleName, target, range);
      if (customLenses.length > 0) {
        codeLens.push(...customLenses);
      }

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

// Type definitions for user-defined CodeLens configurations
interface CustomCodeLensConfig {
  title?: string;
  command?: string;
  Command?: string; // support user typo casing
  postfix_target?: string | string[];
  postfixTarget?: string | string[]; // support camelCase
  terminal?: boolean;
  Terminal?: boolean; // support user typo casing
  arguments?: unknown[];
  Arguments?: unknown[]; // support user typo casing
}

interface RuleConfig {
  code_lens?: CustomCodeLensConfig[];
  codeLens?: CustomCodeLensConfig[]; // support camelCase
}

/**
 * Retrieves custom user-defined code lenses for a specific Please rule name.
 */
function getCustomCodeLenses(
  ruleName: string,
  target: string,
  range: vscode.Range
): vscode.CodeLens[] {
  const codeLenses: vscode.CodeLens[] = [];
  const pleaseConfig = vscode.workspace
    .getConfiguration()
    .get<Record<string, RuleConfig>>('please');

  if (!pleaseConfig || typeof pleaseConfig !== 'object') {
    return codeLenses;
  }

  const ruleConfig = pleaseConfig[ruleName];
  if (!ruleConfig || typeof ruleConfig !== 'object') {
    return codeLenses;
  }

  const lenses = ruleConfig.code_lens || ruleConfig.codeLens;
  if (!Array.isArray(lenses)) {
    return codeLenses;
  }

  for (const lens of lenses) {
    const title = lens.title;
    const command = lens.command || lens.Command;
    const userArgs = lens.arguments || lens.Arguments || [];

    const rawPostfix = lens.postfix_target !== undefined ? lens.postfix_target : lens.postfixTarget;
    const postfixes: string[] = Array.isArray(rawPostfix)
      ? rawPostfix
      : typeof rawPostfix === 'string'
      ? [rawPostfix]
      : [''];

    for (const postfix of postfixes) {
      const resolvedTarget = target + postfix;
      // If an array of multiple postfixes is provided, make code lens titles distinct
      const resolvedTitle =
        title && Array.isArray(rawPostfix) && rawPostfix.length > 1
          ? `${title} (${postfix})`
          : title;

      if (resolvedTitle && command) {
        let resolvedCommand = command;
        let resolvedArgs: unknown[] = [];

        const replaceTarget = (val: unknown): unknown => {
          if (typeof val === 'string') {
            return val
              .replace(/\${target}/g, resolvedTarget)
              .replace(/\$target/g, resolvedTarget);
          }
          if (Array.isArray(val)) {
            return val.map(replaceTarget);
          }
          if (val && typeof val === 'object') {
            const res: Record<string, unknown> = {};
            for (const k of Object.keys(val)) {
              res[k] = replaceTarget((val as Record<string, unknown>)[k]);
            }
            return res;
          }
          return val;
        };

        const parts = command.trim().split(/\s+/);
        if (parts[0] === 'plz' && parts.length > 1) {
          resolvedCommand = 'plz';
          const processedUserArgs = userArgs.map(replaceTarget);
          const containsTarget =
            JSON.stringify(userArgs).includes('${target}') ||
            JSON.stringify(userArgs).includes('$target');
          const finalSubArgs = containsTarget
            ? processedUserArgs
            : [resolvedTarget, ...processedUserArgs];

          const terminalFlag = lens.terminal !== undefined ? lens.terminal : lens.Terminal;

          resolvedArgs = [
            {
              command: parts[1],
              args: finalSubArgs,
              ...(terminalFlag !== undefined ? { terminal: terminalFlag } : {})
            },
          ];
        } else {
          resolvedArgs = userArgs.map(replaceTarget);
        }

        codeLenses.push(
          new vscode.CodeLens(range, {
            title: resolvedTitle,
            command: resolvedCommand,
            arguments: resolvedArgs,
          })
        );
      }
    }
  }

  return codeLenses;
}
