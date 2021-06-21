/*---------------------------------------------------------
 * Copyright 2020 The Go Authors. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

import { ChildProcess } from 'child_process';
import * as kill from 'tree-kill';

// Kill a process and its children, returning a promise.
export function killProcessTree(
  p: ChildProcess,
  logger?: (...args: any[]) => void
): Promise<void> {
  if (!logger) {
    logger = console.log;
  }
  if (!p || !p.pid || p.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    kill(p.pid, (err) => {
      if (err) {
        logger(`Error killing process ${p.pid}: ${err}`);
      }
      resolve();
    });
  });
}
