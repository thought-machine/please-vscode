import { ChildProcessWithoutNullStreams } from 'child_process';
import * as net from 'net';
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

      this.server = plz.detachCommand([
        'debug',
        '-o=python.debugger:debugpy',
        `--port=${port}`,
        session.configuration.target,
        '--',
        ...session.configuration.runtimeArgs,
      ]);

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
