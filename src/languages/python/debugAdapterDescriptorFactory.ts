import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';

import * as plz from '../../please';
import { random } from '../../utils';

export class PythonDebugAdapterDescriptorProvider
  implements vscode.DebugAdapterDescriptorFactory
{
  private server?: ChildProcessWithoutNullStreams;

  async createDebugAdapterDescriptor(
    session: vscode.DebugSession,
    executable: vscode.DebugAdapterExecutable | undefined
  ): Promise<vscode.ProviderResult<vscode.DebugAdapterDescriptor>> {
    return new Promise((resolve, reject) => {
      const port = random(2000, 50000);

      this.server = spawn(
        '/home/ttristao/code/please/plz-out/please/plz', // TODO: plz.binPath()
        [
          '--noupdate', // TODO: Remove
          '--plain_output',
          '--verbosity=info',
          'debug',
          '--debugger=debugpy',
          `--port=${port}`,
          session.configuration.target,
          '--',
          ...session.configuration.runtimeArgs,
        ],
        {
          cwd: plz.repoRoot() || path.resolve('.'),
          env: process.env,
        }
      );

      // Not only we want the `true` argument to prevent the channel from gaining focus,
      // but also it sorts out an issue with `setTimeout` (in `onServerListening`) that
      // isn't guaranteed to always execute its callback. My educated guess would be
      // that changing focus between different UI windows migth be causing this issue.
      plz.outputChannel.show(true);

      this.server.stderr.on('data', (data) =>
        plz.outputChannel.appendLine(data)
      );
      this.server.stdout.on('data', (data) =>
        plz.outputChannel.appendLine(data)
      );

      this.server.on('error', (err) => reject(err));

      // We don't know how long the plz command will take to prepare and
      // expose the debug server, so we need to wait until it is ready
      // before trying to connect to it.
      onServerListening(port, () =>
        resolve(new vscode.DebugAdapterServer(port))
      );
    });
  }

  dispose() {
    this.server?.disconnect();
  }
}

// A callback gets executed once a server starts listening on a given port.
// The implementation is a bit hacky but Node.js doesn't provide better
// primitives for the job.
// There's some likelihood that we attempt to listen on the port just before
// the other process tries to do it as well causing it to fail.
function onServerListening(port: number, callback: () => void): void {
  const server = net.createServer();

  server.on('error', () => {
    callback();
  });

  server.on('listening', () => {
    server.close(() => {
      setTimeout(onServerListening, 250, port, callback);
    });
  });

  server.listen(port);
}
