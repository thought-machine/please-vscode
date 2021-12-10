import * as plz from '../please';

import { argumentPrompt } from './utils';

export async function plzCommand(args: {
  command: string;
  args?: string[];
  runtime?: boolean;
}): Promise<void> {
  const { command, args: commandArgs = [], runtime = false } = args;

  let runtimeArgs: string | undefined;
  if (runtime) {
    runtimeArgs = await argumentPrompt(
      `key-plz-${command}-${commandArgs.join('-')}`
    );
    // Terminate if `Escape` key was pressed.
    if (runtimeArgs === undefined) {
      return;
    }
  }

  let wholeCommand = [command, ...commandArgs];
  if (runtimeArgs) {
    wholeCommand = [...wholeCommand, '--', ...runtimeArgs.split(' ')];
  }

  plz.detachCommand(wholeCommand);
}
