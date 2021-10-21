/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

import { ChildProcess, execFile } from 'child_process';
import * as vscode from 'vscode';

import { NearestNeighborDict, Node } from './avlTree';

// Keep in sync with https://github.com/ramya-rao-a/go-outline
export interface GoOutlineRange {
  start: number;
  end: number;
}

export interface GoOutlineDeclaration {
  label: string;
  type: string;
  receiverType?: string;
  icon?: string; // icon class or null to use the default images based on the type
  start: number;
  end: number;
  children?: GoOutlineDeclaration[];
  signature?: GoOutlineRange;
  comment?: GoOutlineRange;
}

export enum GoOutlineImportsOptions {
  Include,
  Exclude,
  Only,
}

export interface GoOutlineOptions {
  /**
   * Path of the file for which outline is needed
   */
  fileName: string;

  /**
   * Option to decide if the output includes, excludes or only includes imports
   * If the option is to only include imports, then the file will be parsed only till imports are collected
   */
  importsOption: GoOutlineImportsOptions;

  /**
   * Document to be parsed. If not provided, saved contents of the given fileName is used
   */
  document?: vscode.TextDocument;
}

export async function documentSymbols(
  goOutlinePath: string,
  document: vscode.TextDocument,
  token: vscode.CancellationToken
): Promise<vscode.DocumentSymbol[]> {
  const options: GoOutlineOptions = {
    fileName: document.fileName,
    document,
    importsOption: GoOutlineImportsOptions.Exclude,
  };
  const decls = await runGoOutline(goOutlinePath, options, token);
  return convertToCodeSymbols(
    options.document,
    decls,
    options.importsOption !== GoOutlineImportsOptions.Exclude,
    makeMemoizedByteOffsetConverter(Buffer.from(options.document.getText()))
  );
}

export function runGoOutline(
  goOutlinePath: string,
  options: GoOutlineOptions,
  token: vscode.CancellationToken
): Promise<GoOutlineDeclaration[]> {
  return new Promise<GoOutlineDeclaration[]>((resolve, reject) => {
    const gooutlineFlags = ['-f', options.fileName];
    if (options.importsOption === GoOutlineImportsOptions.Only) {
      gooutlineFlags.push('-imports-only');
    }
    if (options.document) {
      gooutlineFlags.push('-modified');
    }

    let p: ChildProcess;
    if (token) {
      token.onCancellationRequested(() => killProcess(p));
    }

    // Spawn `go-outline` process
    p = execFile(goOutlinePath, gooutlineFlags, (err, stdout, stderr) => {
      try {
        if (stderr && stderr.startsWith('flag provided but not defined: ')) {
          if (
            stderr.startsWith('flag provided but not defined: -imports-only')
          ) {
            options.importsOption = GoOutlineImportsOptions.Include;
          }
          if (stderr.startsWith('flag provided but not defined: -modified')) {
            options.document = null;
          }
          p = null;
          return runGoOutline(goOutlinePath, options, token).then((results) => {
            return resolve(results);
          });
        }
        if (err) {
          return resolve(null);
        }
        const result = stdout.toString();
        const decls = <GoOutlineDeclaration[]>JSON.parse(result);
        return resolve(decls);
      } catch (e) {
        reject(e);
      }
    });
    if (options.document && p.pid) {
      p.stdin.end(getFileArchive(options.document));
    }
  });
}

const goKindToCodeKind: { [key: string]: vscode.SymbolKind } = {
  package: vscode.SymbolKind.Package,
  import: vscode.SymbolKind.Namespace,
  variable: vscode.SymbolKind.Variable,
  constant: vscode.SymbolKind.Constant,
  type: vscode.SymbolKind.TypeParameter,
  function: vscode.SymbolKind.Function,
  struct: vscode.SymbolKind.Struct,
  interface: vscode.SymbolKind.Interface,
};

function convertToCodeSymbols(
  document: vscode.TextDocument,
  decls: GoOutlineDeclaration[],
  includeImports: boolean,
  byteOffsetToDocumentOffset: (byteOffset: number) => number
): vscode.DocumentSymbol[] {
  const symbols: vscode.DocumentSymbol[] = [];
  (decls || []).forEach((decl) => {
    if (!includeImports && decl.type === 'import') {
      return;
    }
    if (decl.label === '_' && decl.type === 'variable') {
      return;
    }

    const label = decl.receiverType
      ? `(${decl.receiverType}).${decl.label}`
      : decl.label;

    const start = byteOffsetToDocumentOffset(decl.start - 1);
    const end = byteOffsetToDocumentOffset(decl.end - 1);
    const startPosition = document.positionAt(start);
    const endPosition = document.positionAt(end);
    const symbolRange = new vscode.Range(startPosition, endPosition);
    const selectionRange =
      startPosition.line === endPosition.line
        ? symbolRange
        : new vscode.Range(
            startPosition,
            document.lineAt(startPosition.line).range.end
          );

    if (decl.type === 'type') {
      const line = document.lineAt(document.positionAt(start));
      const regexStruct = new RegExp(`^\\s*type\\s+${decl.label}\\s+struct\\b`);
      const regexInterface = new RegExp(
        `^\\s*type\\s+${decl.label}\\s+interface\\b`
      );
      decl.type = regexStruct.test(line.text)
        ? 'struct'
        : regexInterface.test(line.text)
        ? 'interface'
        : 'type';
    }

    const symbolInfo = new vscode.DocumentSymbol(
      label,
      decl.type,
      goKindToCodeKind[decl.type],
      symbolRange,
      selectionRange
    );

    symbols.push(symbolInfo);
    if (decl.children) {
      symbolInfo.children = convertToCodeSymbols(
        document,
        decl.children,
        includeImports,
        byteOffsetToDocumentOffset
      );
    }
  });
  return symbols;
}

function getFileArchive(document: vscode.TextDocument): string {
  const fileContents = document.getText();
  return (
    document.fileName +
    '\n' +
    Buffer.byteLength(fileContents, 'utf8') +
    '\n' +
    fileContents
  );
}

function makeMemoizedByteOffsetConverter(
  buffer: Buffer
): (byteOffset: number) => number {
  const defaultValue = new Node<number, number>(0, 0); // 0 bytes will always be 0 characters
  const memo = new NearestNeighborDict(
    defaultValue,
    NearestNeighborDict.NUMERIC_DISTANCE_FUNCTION
  );
  return (byteOffset: number) => {
    const nearest = memo.getNearest(byteOffset);
    const byteDelta = byteOffset - nearest.key;

    if (byteDelta === 0) {
      return nearest.value;
    }

    let charDelta: number;
    if (byteDelta > 0) {
      charDelta = buffer.toString('utf8', nearest.key, byteOffset).length;
    } else {
      charDelta = -buffer.toString('utf8', byteOffset, nearest.key).length;
    }

    memo.insert(byteOffset, nearest.value + charDelta);
    return nearest.value + charDelta;
  };
}

// Kill a process.
//
// READ THIS BEFORE USING THE FUNCTION:
//
// TODO: This function is kept for historical reasons and should be removed once
// its user (go-outline) is replaced. Outlining uses this function and not
// killProcessTree because of performance issues that were observed in the past.
// See https://go-review.googlesource.com/c/vscode-go/+/242518/ for more
// details and background.
function killProcess(p: ChildProcess) {
  if (p && p.pid && p.exitCode === null) {
    try {
      p.kill();
    } catch (e) {
      console.log(`Error killing process ${p.pid}: ${e}`);
    }
  }
}
