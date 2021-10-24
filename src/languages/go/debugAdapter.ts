/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

import { ChildProcess, execFile, spawn } from 'child_process';
import * as fs from 'fs';
import { existsSync } from 'fs';
import { Client, RPCConnection } from 'json-rpc2';
import * as path from 'path';
import * as util from 'util';
import {
  DebugSession,
  ErrorDestination,
  Handles,
  InitializedEvent,
  logger,
  LoggingDebugSession,
  OutputEvent,
  Scope,
  Source,
  StackFrame,
  StoppedEvent,
  TerminatedEvent,
  Thread,
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { fixDriveCasingInWindows, getBinPath } from '../../utils/pathUtils';
import { killProcessTree } from '../../utils/processUtils';

const fsAccess = util.promisify(fs.access);
const fsUnlink = util.promisify(fs.unlink);

// This enum should stay in sync with https://golang.org/pkg/reflect/#Kind

enum GoReflectKind {
  Invalid = 0,
  Bool,
  Int,
  Int8,
  Int16,
  Int32,
  Int64,
  Uint,
  Uint8,
  Uint16,
  Uint32,
  Uint64,
  Uintptr,
  Float32,
  Float64,
  Complex64,
  Complex128,
  Array,
  Chan,
  Func,
  Interface,
  Map,
  Ptr,
  Slice,
  String,
  Struct,
  UnsafePointer,
}

// These types should stay in sync with:
// https://github.com/go-delve/delve/blob/master/service/api/types.go

interface CommandOut {
  State: DebuggerState;
}

interface DebuggerState {
  exited: boolean;
  exitStatus: number;
  currentThread: DebugThread;
  currentGoroutine: DebugGoroutine;
  Running: boolean;
  Threads: DebugThread[];
  NextInProgress: boolean;
}

export interface PackageBuildInfo {
  ImportPath: string;
  DirectoryPath: string;
  Files: string[];
}

export interface ListPackagesBuildInfoOut {
  List: PackageBuildInfo[];
}

export interface ListSourcesOut {
  Sources: string[];
}

interface CreateBreakpointOut {
  Breakpoint: DebugBreakpoint;
}

interface GetVersionOut {
  DelveVersion: string;
  APIVersion: number;
}

interface DebugBreakpoint {
  addr: number;
  continue: boolean;
  file: string;
  functionName?: string;
  goroutine: boolean;
  id: number;
  name: string;
  line: number;
  stacktrace: number;
  variables?: DebugVariable[];
  loadArgs?: LoadConfig;
  loadLocals?: LoadConfig;
  cond?: string;
}

interface LoadConfig {
  // FollowPointers requests pointers to be automatically dereferenced.
  followPointers: boolean;
  // MaxVariableRecurse is how far to recurse when evaluating nested types.
  maxVariableRecurse: number;
  // MaxStringLen is the maximum number of bytes read from a string
  maxStringLen: number;
  // MaxArrayValues is the maximum number of elements read from an array, a slice or a map.
  maxArrayValues: number;
  // MaxStructFields is the maximum number of fields read from a struct, -1 will read all fields.
  maxStructFields: number;
}

interface DebugThread {
  file: string;
  id: number;
  line: number;
  pc: number;
  goroutineID: number;
  breakPoint: DebugBreakpoint;
  breakPointInfo: {};
  function?: DebugFunction;
  ReturnValues: DebugVariable[];
}

interface StacktraceOut {
  Locations: DebugLocation[];
}

interface DebugLocation {
  pc: number;
  file: string;
  line: number;
  function: DebugFunction;
}

interface DebugFunction {
  name: string;
  value: number;
  type: number;
  goType: number;
  args: DebugVariable[];
  locals: DebugVariable[];
  optimized: boolean;
}

interface ListVarsOut {
  Variables: DebugVariable[];
}

interface ListFunctionArgsOut {
  Args: DebugVariable[];
}

interface EvalOut {
  Variable: DebugVariable;
}

enum GoVariableFlags {
  VariableEscaped = 1,
  VariableShadowed = 2,
  VariableConstant = 4,
  VariableArgument = 8,
  VariableReturnArgument = 16,
  VariableFakeAddress = 32,
}

interface DebugVariable {
  // DebugVariable corresponds to api.Variable in Delve API.
  // https://github.com/go-delve/delve/blob/328cf87808822693dc611591519689dcd42696a3/service/api/types.go#L239-L284
  name: string;
  addr: number;
  type: string;
  realType: string;
  kind: GoReflectKind;
  flags: GoVariableFlags;
  onlyAddr: boolean;
  DeclLine: number;
  value: string;
  len: number;
  cap: number;
  children: DebugVariable[];
  unreadable: string;
  fullyQualifiedName: string;
  base: number;
}

interface ListGoroutinesOut {
  Goroutines: DebugGoroutine[];
}

interface DebugGoroutine {
  id: number;
  currentLoc: DebugLocation;
  userCurrentLoc: DebugLocation;
  goStatementLoc: DebugLocation;
}

interface DebuggerCommand {
  name: string;
  threadID?: number;
  goroutineID?: number;
}

interface ListBreakpointsOut {
  Breakpoints: DebugBreakpoint[];
}

interface RestartOut {
  DiscardedBreakpoints: DiscardedBreakpoint[];
}

interface DiscardedBreakpoint {
  breakpoint: DebugBreakpoint;
  reason: string;
}

// Unrecovered panic and fatal throw breakpoint IDs taken from delve:
// https://github.com/go-delve/delve/blob/f90134eb4db1c423e24fddfbc6eff41b288e6297/pkg/proc/breakpoints.go#L11-L21
// UnrecoveredPanic is the name given to the unrecovered panic breakpoint.
const unrecoveredPanicID = -1;
// FatalThrow is the name given to the breakpoint triggered when the target
// process dies because of a fatal runtime error.
const fatalThrowID = -2;

// The arguments below are usually surfaced to the user in the `package.json` file.
interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
  request: 'launch';
  target: string; // Please target.
  runtimeArgs: string[]; // Runtime args for the target.
  stopOnEntry?: boolean;
  repoRoot: string;
  plzBinPath: string;
  host: string;
  port: number;
  substitutePath?: { from: string; to: string }[];
}

process.on('uncaughtException', (err: any) => {
  const errMessage = err && (err.stack || err.message);
  logger.error(`Unhandled error in debug adapter: ${errMessage}`);
  throw err;
});

function logArgsToString(args: any[]): string {
  return args
    .map((arg) => {
      return typeof arg === 'string' ? arg : JSON.stringify(arg);
    })
    .join(' ');
}

function log(...args: any[]) {
  logger.warn(logArgsToString(args));
}

function logError(...args: any[]) {
  logger.error(logArgsToString(args));
}

function findPathSeparator(filePath: string) {
  return filePath.includes('/') ? '/' : '\\';
}

// Comparing two different file paths while ignoring any different path separators.
function compareFilePathIgnoreSeparator(
  firstFilePath: string,
  secondFilePath: string
): boolean {
  const firstSeparator = findPathSeparator(firstFilePath);
  const secondSeparator = findPathSeparator(secondFilePath);
  if (firstSeparator === secondSeparator) {
    return firstFilePath === secondFilePath;
  }
  return (
    firstFilePath === secondFilePath.split(secondSeparator).join(firstSeparator)
  );
}

export function escapeGoModPath(filePath: string) {
  return filePath.replace(
    /[A-Z]/g,
    (match: string) => `!${match.toLocaleLowerCase()}`
  );
}

function normalizePath(filePath: string) {
  if (process.platform === 'win32') {
    const pathSeparator = findPathSeparator(filePath);
    filePath = path.normalize(filePath);
    // Normalize will replace everything with backslash on Windows.
    filePath = filePath.replace(/\\/g, pathSeparator);
    return fixDriveCasingInWindows(filePath);
  }
  return filePath;
}

// normalizeSeparators will prepare the filepath for comparison in mapping from
// local to debugger path and from debugger path to local path. All separators are
// replaced with '/', and the drive name is capitalized for windows paths.
// Exported for testing
export function normalizeSeparators(filePath: string): string {
  // Although the current machine may not be running windows,
  // the remote machine may be and we need to fix the drive
  // casing.
  // This is a workaround for issue in https://github.com/Microsoft/vscode/issues/9448#issuecomment-244804026
  if (filePath.indexOf(':') === 1) {
    filePath = filePath.substr(0, 1).toUpperCase() + filePath.substr(1);
  }
  return filePath.replace(/\/|\\/g, '/');
}

export class Delve {
  public program: string;
  public loadConfig: LoadConfig;
  public connection: Promise<RPCConnection>;
  public onstdout: (str: string) => void;
  public onstderr: (str: string) => void;
  public onclose: (code: number) => void;
  public stackTraceDepth: number;
  public goroot: string;
  public delveConnectionClosed = false;
  private localDebugeePath: string | undefined;
  private debugProcess: ChildProcess;

  constructor(launchArgs: LaunchRequestArguments, target: string) {
    this.stackTraceDepth = 50;
    this.connection = new Promise(async (resolve, reject) => {
      let serverRunning = false;

      // Get default LoadConfig values according to delve API:
      // https://github.com/go-delve/delve/blob/c5c41f635244a22d93771def1c31cf1e0e9a2e63/service/rpc1/server.go#L13
      // https://github.com/go-delve/delve/blob/c5c41f635244a22d93771def1c31cf1e0e9a2e63/service/rpc2/server.go#L423
      this.loadConfig = {
        followPointers: true,
        maxVariableRecurse: 1,
        maxStringLen: 64,
        maxArrayValues: 64,
        maxStructFields: -1,
      };

      // Validations on the target
      if (!target) {
        return reject(
          'The target attribute is missing in the debug configuration in launch.json'
        );
      }

      this.goroot = await queryGOROOT(launchArgs.repoRoot, process.env);

      log(`Using GOPATH: ${process.env['GOPATH']}`);
      log(`Using GOROOT: ${this.goroot}`);
      log(`Using PATH: ${process.env['PATH']}`);

      if (!existsSync(launchArgs.plzBinPath)) {
        return reject(
          'Cannot find Please. Install from https://github.com/thought-machine/please and ensure it is in the "PATH" environment variable.'
        );
      }

      const plzArgs: Array<string> = [
        '--noupdate', // TODO: Remove
        '--plain_output',
        '--verbosity=info',
        'debug',
        `--port=${launchArgs.port}`,
        target,
        '--',
        ...launchArgs.runtimeArgs,
      ];

      log(`Running: ${launchArgs.plzBinPath} ${plzArgs.join(' ')}`);

      this.debugProcess = spawn(launchArgs.plzBinPath, plzArgs, {
        cwd: launchArgs.repoRoot,
      });

      function connectClient(port: number, host: string) {
        // Add a slight delay to avoid issues on Linux with
        // Delve failing calls made shortly after connection.
        setTimeout(() => {
          const client = Client.$create(port, host);
          client.connectSocket((err, conn) => {
            if (err) {
              return reject(err);
            }
            return resolve(conn);
          });
          client.on('error', reject);
        }, 200);
      }

      this.debugProcess.stderr.on('data', (chunk) => {
        const str = chunk.toString();
        if (this.onstderr) {
          this.onstderr(str);
        }
      });
      this.debugProcess.stdout.on('data', (chunk) => {
        const str = chunk.toString();
        if (this.onstdout) {
          this.onstdout(str);
        }
        if (!serverRunning) {
          serverRunning = true;
          connectClient(launchArgs.port, launchArgs.host);
        }
      });
      this.debugProcess.on('close', (code) => {
        // TODO: Report `dlv` crash to user.
        logError('Process exiting with code: ' + code);
        if (this.onclose) {
          this.onclose(code);
        }
      });
      this.debugProcess.on('error', (err) => {
        reject(err);
      });
    });
  }

  public call<T>(
    command: string,
    args: any[],
    callback: (err: Error, results: T) => void
  ) {
    this.connection.then(
      (conn) => {
        conn.call('RPCServer.' + command, args, callback);
      },
      (err) => {
        callback(err, null);
      }
    );
  }

  public callPromise<T>(command: string, args: any[]): Thenable<T> {
    return new Promise<T>((resolve, reject) => {
      this.connection.then(
        (conn) => {
          conn.call<T>(`RPCServer.${command}`, args, (err, res) => {
            return err ? reject(err) : resolve(res);
          });
        },
        (err) => {
          reject(err);
        }
      );
    });
  }

  /**
   * Returns the current state of the delve debugger.
   * This method does not block delve and should return immediately.
   */
  public async getDebugState(): Promise<DebuggerState> {
    // If a program is launched with --continue, the program is running
    // before we can run attach. So we would need to check the state.
    // We use NonBlocking so the call would return immediately.
    const callResult = await this.callPromise<CommandOut>('State', [
      { NonBlocking: true },
    ]);
    return callResult.State;
  }

  /**
   * Closing a debugging session follows different approaches for launch vs attach debugging.
   *
   * For launch without debugging, we kill the process since the extension started the `go run` process.
   *
   * For launch debugging, since the extension starts the delve process, the extension should close it as well.
   * To gracefully clean up the assets created by delve, we send the Detach request with kill option set to true.
   *
   * For attach debugging there are two scenarios; attaching to a local process by ID or connecting to a
   * remote delve server.  For attach-local we start the delve process so will also terminate it however we
   * detach from the debugee without killing it.  For attach-remote we only close the client connection,
   * but do not terminate the remote server.
   *
   * For local debugging, the only way to detach from delve when it is running a program is to send a Halt request first.
   * Since the Halt request might sometimes take too long to complete, we have a timer in place to forcefully kill
   * the debug process and clean up the assets in case of local debugging
   */
  public async close(): Promise<void> {
    const forceCleanup = async () => {
      log(`killing debugee (pid: ${this.debugProcess.pid})...`);
      await killProcessTree(this.debugProcess, log);
      await removeFile(this.localDebugeePath);
    };

    return new Promise(async (resolve) => {
      this.delveConnectionClosed = true;

      const timeoutToken: NodeJS.Timer =
        !!this.debugProcess &&
        setTimeout(async () => {
          log(
            'Killing debug process manually as we could not halt delve in time'
          );
          await forceCleanup();
          resolve();
        }, 1000);

      let haltErrMsg: string;
      try {
        log('HaltRequest');
        await this.callPromise('Command', [{ name: 'halt' }]);
      } catch (err) {
        log('HaltResponse');
        haltErrMsg = err ? err.toString() : '';
        log(`Failed to halt - ${haltErrMsg}`);
      }
      clearTimeout(timeoutToken);

      const targetHasExited: boolean =
        haltErrMsg && haltErrMsg.endsWith('has exited with status 0');
      const shouldDetach: boolean = !haltErrMsg || targetHasExited;
      let shouldForceClean: boolean = !shouldDetach && !!this.debugProcess;
      if (shouldDetach) {
        log('DetachRequest');
        try {
          await this.callPromise('Detach', [{ Kill: !!this.debugProcess }]);
        } catch (err) {
          log('DetachResponse');
          logError(`Failed to detach - ${err.toString() || ''}`);
          shouldForceClean = !!this.debugProcess;
        }
      }
      if (shouldForceClean) {
        await forceCleanup();
      }
      return resolve();
    });
  }
}

export class GoDebugSession extends LoggingDebugSession {
  private variableHandles: Handles<DebugVariable>;
  private breakpoints: Map<string, DebugBreakpoint[]>;
  // Editing breakpoints requires halting delve, skip sending Stop Event to VS Code in such cases
  private skipStopEventOnce: boolean;
  private overrideStopReason: string;
  private debugState: DebuggerState;
  private delve: Delve;
  private pathSeparator: string;
  private stackFrameHandles: Handles<[number, number]>;
  private packageInfo = new Map<string, string>();
  private stopOnEntry: boolean;
  private readonly initdone = 'initdone·';

  // TODO(suzmue): Use delve's implementation of substitute-path.
  private substitutePath: { from: string; to: string }[];

  private showGlobalVariables = false;

  private continueEpoch = 0;
  private continueRequestRunning = false;
  private nextEpoch = 0;
  private nextRequestRunning = false;
  public constructor(
    debuggerLinesStartAt1: boolean,
    isServer = false,
    readonly fileSystem = fs
  ) {
    super('', debuggerLinesStartAt1, isServer);
    this.variableHandles = new Handles<DebugVariable>();
    this.skipStopEventOnce = false;
    this.overrideStopReason = '';
    this.stopOnEntry = false;
    this.debugState = null;
    this.delve = null;
    this.breakpoints = new Map<string, DebugBreakpoint[]>();
    this.stackFrameHandles = new Handles<[number, number]>();
  }

  protected initializeRequest(
    response: DebugProtocol.InitializeResponse,
    args: DebugProtocol.InitializeRequestArguments
  ): void {
    log('InitializeRequest');
    // Set the capabilities that this debug adapter supports.
    response.body.supportsConditionalBreakpoints = true;
    response.body.supportsConfigurationDoneRequest = true;
    response.body.supportsSetVariable = true;
    this.sendResponse(response);
    log('InitializeResponse');
  }

  protected launchRequest(
    response: DebugProtocol.LaunchResponse,
    args: LaunchRequestArguments
  ): void {
    log('LaunchRequest');
    if (!args.target) {
      this.sendErrorResponse(
        response,
        3000,
        'Failed to continue: The target attribute is missing in the debug configuration in launch.json'
      );
      return;
    }
    this.initLaunchRequest(response, args);
  }

  protected attachRequest(
    response: DebugProtocol.AttachResponse,
    args: unknown
  ): void {
    this.sendErrorResponse(
      response,
      3000,
      'Failed to continue: The attach request option is not available'
    );
  }

  protected async disconnectRequest(
    response: DebugProtocol.DisconnectResponse,
    args: DebugProtocol.DisconnectArguments
  ): Promise<void> {
    log('DisconnectRequest');
    if (this.delve) {
      // Since users want to reset when they issue a disconnect request,
      // we should have a timeout in case disconnectRequestHelper hangs.
      await Promise.race([
        this.disconnectRequestHelper(response, args),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            log('DisconnectRequestHelper timed out after 5s.');
            resolve();
          }, 5_000)
        ),
      ]);
    }

    this.shutdownProtocolServer(response, args);
    log('DisconnectResponse');
  }

  protected async disconnectRequestHelper(
    response: DebugProtocol.DisconnectResponse,
    args: DebugProtocol.DisconnectArguments
  ): Promise<void> {
    // There is a chance that a second disconnectRequest can come through
    // if users click detach multiple times. In that case, we want to
    // guard against talking to the closed Delve connection.
    // Note: this does not completely guard against users attempting to
    // disconnect multiple times when a disconnect request is still running.
    // The order of the execution may results in strange states that don't allow
    // the delve connection to fully disconnect.
    if (this.delve.delveConnectionClosed) {
      log(
        "Skip disconnectRequestHelper as Delve's connection is already closed."
      );
      return;
    }

    log('Closing Delve.');
    await this.delve.close();
  }

  protected async configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse,
    args: DebugProtocol.ConfigurationDoneArguments
  ): Promise<void> {
    log('ConfigurationDoneRequest');
    if (this.stopOnEntry) {
      this.sendEvent(new StoppedEvent('entry', 1));
      log('StoppedEvent("entry")');
    } else if (!(await this.isDebuggeeRunning())) {
      log('Changing DebugState from Halted to Running');
      this.continue();
    }
    this.sendResponse(response);
    log('ConfigurationDoneResponse', response);
  }

  protected async toDebuggerPath(filePath: string): Promise<string> {
    if (this.substitutePath.length === 0) {
      return this.convertClientPathToDebugger(filePath);
    }

    // The filePath may have a different path separator than the localPath
    // So, update it to use the same separator for ease in path replacement.
    filePath = normalizeSeparators(filePath);
    let substitutedPath = filePath;
    let substituteRule: { from: string; to: string };
    this.substitutePath.forEach((value) => {
      if (filePath.startsWith(value.from)) {
        if (substituteRule) {
          log(
            `Substitutition rule ${value.from}:${value.to} applies to local path ${filePath} but it was already mapped to debugger path using rule ${substituteRule.from}:${substituteRule.to}`
          );
          return;
        }
        substitutedPath = filePath.replace(value.from, value.to);
        substituteRule = { from: value.from, to: value.to };
      }
    });
    filePath = substitutedPath;

    return (filePath = filePath.replace(/\/|\\/g, this.pathSeparator));
  }

  /**
   * This functions assumes that remote packages and paths information
   * have been initialized.
   */
  protected toLocalPath(pathToConvert: string): string {
    if (this.substitutePath.length === 0) {
      return this.convertDebuggerPathToClient(pathToConvert);
    }

    // If there is a substitutePath mapping, then we replace the path.
    pathToConvert = normalizeSeparators(pathToConvert);
    let substitutedPath = pathToConvert;
    let substituteRule: { from: string; to: string };
    this.substitutePath.forEach((value) => {
      if (pathToConvert.startsWith(value.to)) {
        if (substituteRule) {
          log(
            `Substitutition rule ${value.from}:${value.to} applies to debugger path ${pathToConvert} but it was already mapped to local path using rule ${substituteRule.from}:${substituteRule.to}`
          );
          return;
        }
        substitutedPath = pathToConvert.replace(value.to, value.from);
        substituteRule = { from: value.from, to: value.to };
      }
    });
    pathToConvert = substitutedPath;

    // When the pathToConvert is under GOROOT or Go module cache, replace path appropriately
    if (!substituteRule) {
      // Fix for https://github.com/Microsoft/vscode-go/issues/1178
      const index = pathToConvert.indexOf(
        `${this.pathSeparator}src${this.pathSeparator}`
      );
      const goroot = this.getGOROOT();
      if (goroot && index > 0) {
        return path.join(goroot, pathToConvert.substr(index));
      }

      const indexGoModCache = pathToConvert.indexOf(
        `${this.pathSeparator}pkg${this.pathSeparator}mod${this.pathSeparator}`
      );
      const gopath = (process.env['GOPATH'] || '').split(path.delimiter)[0];

      if (gopath && indexGoModCache > 0) {
        return path.join(gopath, pathToConvert.substr(indexGoModCache));
      }
    }
    return pathToConvert;
  }

  protected async setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments
  ): Promise<void> {
    log('SetBreakPointsRequest');
    if (!(await this.isDebuggeeRunning())) {
      log('Debuggee is not running. Setting breakpoints without halting.');
      await this.setBreakPoints(response, args);
    } else {
      // Skip stop event if a continue request is running.
      this.skipStopEventOnce = this.continueRequestRunning;
      const haltedDuringNext = this.nextRequestRunning;
      if (haltedDuringNext) {
        this.overrideStopReason = 'next cancelled';
      }

      log(
        `Halting before setting breakpoints. SkipStopEventOnce is ${this.skipStopEventOnce}.`
      );
      this.delve.callPromise('Command', [{ name: 'halt' }]).then(
        () => {
          return this.setBreakPoints(response, args).then(() => {
            // We do not want to continue if it was running a next request, since the
            // request was automatically cancelled.
            if (haltedDuringNext) {
              // Send an output event containing a warning that next was cancelled.
              const warning =
                "Setting breakpoints during 'next', 'step in' or 'step out' halted delve and cancelled the next request";
              this.sendEvent(new OutputEvent(warning, 'stderr'));
              return;
            }
            return this.continue(true).then(null, (err) => {
              this.logDelveError(
                err,
                'Failed to continue delve after halting it to set breakpoints'
              );
            });
          });
        },
        (err) => {
          this.skipStopEventOnce = false;
          this.logDelveError(
            err,
            'Failed to halt delve before attempting to set breakpoint'
          );
          return this.sendErrorResponse(
            response,
            2008,
            'Failed to halt delve before attempting to set breakpoint: "{e}"',
            { e: err.toString() }
          );
        }
      );
    }
  }

  protected async threadsRequest(
    response: DebugProtocol.ThreadsResponse
  ): Promise<void> {
    if (await this.isDebuggeeRunning()) {
      // Thread request to delve is synchronous and will block if a previous async continue request didn't return
      response.body = { threads: [new Thread(1, 'Dummy')] };
      return this.sendResponse(response);
    } else if (this.debugState && this.debugState.exited) {
      // If the program exits very quickly, the initial threadsRequest will complete after it has exited.
      // A TerminatedEvent has already been sent. d
      response.body = { threads: [] };
      return this.sendResponse(response);
    }
    log('ThreadsRequest');
    this.delve.call<DebugGoroutine[] | ListGoroutinesOut>(
      'ListGoroutines',
      [],
      (err, out) => {
        if (this.debugState && this.debugState.exited) {
          // If the program exits very quickly, the initial threadsRequest will complete after it has exited.
          // A TerminatedEvent has already been sent. Ignore the err returned in this case.
          response.body = { threads: [] };
          return this.sendResponse(response);
        }

        if (err) {
          this.logDelveError(err, 'Failed to get threads');
          return this.sendErrorResponse(
            response,
            2003,
            'Unable to display threads: "{e}"',
            {
              e: err.toString(),
            }
          );
        }
        const goroutines = (<ListGoroutinesOut>out).Goroutines;
        log('goroutines', goroutines);
        const threads = goroutines.map(
          (goroutine) =>
            new Thread(
              goroutine.id,
              goroutine.userCurrentLoc.function
                ? goroutine.userCurrentLoc.function.name
                : goroutine.userCurrentLoc.file +
                  '@' +
                  goroutine.userCurrentLoc.line
            )
        );
        if (threads.length === 0) {
          threads.push(new Thread(1, 'Dummy'));
        }
        response.body = { threads };
        this.sendResponse(response);
        log('ThreadsResponse', threads);
      }
    );
  }

  protected async stackTraceRequest(
    response: DebugProtocol.StackTraceResponse,
    args: DebugProtocol.StackTraceArguments
  ): Promise<void> {
    log('StackTraceRequest');
    // For normal VSCode, this request doesn't get invoked when we send a Dummy thread
    // in the scenario where the debuggee is running.
    // For Theia, however, this does get invoked and so we should just send an error
    // response that we cannot get the stack trace at this point since the debugggee is running.
    if (await this.isDebuggeeRunning()) {
      this.sendErrorResponse(
        response,
        2004,
        'Unable to produce stack trace as the debugger is running'
      );
      return;
    }

    // delve does not support frame paging, so we ask for a large depth
    const goroutineId = args.threadId;
    const stackTraceIn = {
      id: goroutineId,
      depth: this.delve.stackTraceDepth,
      full: false,
      cfg: this.delve.loadConfig,
    };
    this.delve.call<DebugLocation[] | StacktraceOut>(
      'Stacktrace',
      [stackTraceIn],
      async (err, out) => {
        if (err) {
          this.logDelveError(err, 'Failed to produce stacktrace');
          return this.sendErrorResponse(
            response,
            2004,
            'Unable to produce stack trace: "{e}"',
            { e: err.toString() },
            // Disable showUser pop-up since errors already show up under the CALL STACK pane
            null
          );
        }
        const locations = (<StacktraceOut>out).Locations;
        log('locations', locations);

        let stackFrames = locations.map((location, frameId) => {
          const uniqueStackFrameId = this.stackFrameHandles.create([
            goroutineId,
            frameId,
          ]);
          return new StackFrame(
            uniqueStackFrameId,
            location.function ? location.function.name : '<unknown>',
            location.file === '<autogenerated>'
              ? null
              : new Source(
                  path.basename(location.file),
                  this.toLocalPath(location.file)
                ),
            location.line,
            0
          );
        });
        if (args.startFrame > 0) {
          stackFrames = stackFrames.slice(args.startFrame);
        }
        if (args.levels > 0) {
          stackFrames = stackFrames.slice(0, args.levels);
        }
        response.body = { stackFrames, totalFrames: locations.length };
        this.sendResponse(response);
        log('StackTraceResponse');
      }
    );
  }

  protected scopesRequest(
    response: DebugProtocol.ScopesResponse,
    args: DebugProtocol.ScopesArguments
  ): void {
    log('ScopesRequest');
    // TODO(polinasok): this.stackFrameHandles.get should succeed as long as DA
    // clients behaves well. Find the documentation around stack frame management
    // and in case of a failure caused by misbehavior, consider to indicate it
    // in the error response.
    const [goroutineId, frameId] = this.stackFrameHandles.get(args.frameId);
    const listLocalVarsIn = { goroutineID: goroutineId, frame: frameId };
    this.delve.call<DebugVariable[] | ListVarsOut>(
      'ListLocalVars',
      [{ scope: listLocalVarsIn, cfg: this.delve.loadConfig }],
      (err, out) => {
        if (err) {
          this.logDelveError(err, 'Failed to get list local variables');
          return this.sendErrorResponse(
            response,
            2005,
            'Unable to list locals: "{e}"',
            {
              e: err.toString(),
            }
          );
        }
        const locals = (<ListVarsOut>out).Variables;
        log('locals', locals);
        this.addFullyQualifiedName(locals);
        const listLocalFunctionArgsIn = {
          goroutineID: goroutineId,
          frame: frameId,
        };
        this.delve.call<DebugVariable[] | ListFunctionArgsOut>(
          'ListFunctionArgs',
          [{ scope: listLocalFunctionArgsIn, cfg: this.delve.loadConfig }],
          (listFunctionErr, outArgs) => {
            if (listFunctionErr) {
              this.logDelveError(
                listFunctionErr,
                'Failed to list function args'
              );
              return this.sendErrorResponse(
                response,
                2006,
                'Unable to list args: "{e}"',
                {
                  e: listFunctionErr.toString(),
                }
              );
            }
            const vars = (<ListFunctionArgsOut>outArgs).Args;
            log('functionArgs', vars);
            this.addFullyQualifiedName(vars);
            vars.push(...locals);
            // annotate shadowed variables in parentheses
            const shadowedVars = new Map<string, Array<number>>();
            for (let i = 0; i < vars.length; ++i) {
              if ((vars[i].flags & GoVariableFlags.VariableShadowed) === 0) {
                continue;
              }
              const varName = vars[i].name;
              if (!shadowedVars.has(varName)) {
                const indices = new Array<number>();
                indices.push(i);
                shadowedVars.set(varName, indices);
              } else {
                shadowedVars.get(varName).push(i);
              }
            }
            for (const svIndices of shadowedVars.values()) {
              // sort by declared line number in descending order
              svIndices.sort((lhs: number, rhs: number) => {
                return vars[rhs].DeclLine - vars[lhs].DeclLine;
              });
              // enclose in parentheses, one pair per scope
              for (let scope = 0; scope < svIndices.length; ++scope) {
                const svIndex = svIndices[scope];
                // start at -1 so scope of 0 has one pair of parens
                for (let count = -1; count < scope; ++count) {
                  vars[svIndex].name = `(${vars[svIndex].name})`;
                }
              }
            }
            const scopes = new Array<Scope>();
            const localVariables: DebugVariable = {
              name: 'Local',
              addr: 0,
              type: '',
              realType: '',
              kind: 0,
              flags: 0,
              onlyAddr: false,
              DeclLine: 0,
              value: '',
              len: 0,
              cap: 0,
              children: vars,
              unreadable: '',
              fullyQualifiedName: '',
              base: 0,
            };

            scopes.push(
              new Scope(
                'Local',
                this.variableHandles.create(localVariables),
                false
              )
            );
            response.body = { scopes };

            if (!this.showGlobalVariables) {
              this.sendResponse(response);
              log('ScopesResponse');
              return;
            }

            this.getPackageInfo(this.debugState).then((packageName) => {
              if (!packageName) {
                this.sendResponse(response);
                log('ScopesResponse');
                return;
              }
              const filter = `^${packageName}\\.`;
              this.delve.call<DebugVariable[] | ListVarsOut>(
                'ListPackageVars',
                [{ filter, cfg: this.delve.loadConfig }],
                (listPkgVarsErr, listPkgVarsOut) => {
                  if (listPkgVarsErr) {
                    this.logDelveError(
                      listPkgVarsErr,
                      'Failed to list global vars'
                    );
                    return this.sendErrorResponse(
                      response,
                      2007,
                      'Unable to list global vars: "{e}"',
                      { e: listPkgVarsErr.toString() }
                    );
                  }
                  const globals = (<ListVarsOut>listPkgVarsOut).Variables;
                  let initdoneIndex = -1;
                  for (let i = 0; i < globals.length; i++) {
                    globals[i].name = globals[i].name.substr(
                      packageName.length + 1
                    );
                    if (
                      initdoneIndex === -1 &&
                      globals[i].name === this.initdone
                    ) {
                      initdoneIndex = i;
                    }
                  }
                  if (initdoneIndex > -1) {
                    globals.splice(initdoneIndex, 1);
                  }
                  log('global vars', globals);

                  const globalVariables: DebugVariable = {
                    name: 'Global',
                    addr: 0,
                    type: '',
                    realType: '',
                    kind: 0,
                    flags: 0,
                    onlyAddr: false,
                    DeclLine: 0,
                    value: '',
                    len: 0,
                    cap: 0,
                    children: globals,
                    unreadable: '',
                    fullyQualifiedName: '',
                    base: 0,
                  };
                  scopes.push(
                    new Scope(
                      'Global',
                      this.variableHandles.create(globalVariables),
                      false
                    )
                  );
                  this.sendResponse(response);
                  log('ScopesResponse');
                }
              );
            });
          }
        );
      }
    );
  }

  protected variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments
  ): void {
    log('VariablesRequest');
    const vari = this.variableHandles.get(args.variablesReference);
    let variablesPromise: Promise<DebugProtocol.Variable[]>;
    const loadChildren = async (exp: string, v: DebugVariable) => {
      // from https://github.com/go-delve/delve/blob/master/Documentation/api/ClientHowto.md#looking-into-variables
      if (
        (v.kind === GoReflectKind.Struct && v.len > v.children.length) ||
        (v.kind === GoReflectKind.Interface &&
          v.children.length > 0 &&
          v.children[0].onlyAddr === true)
      ) {
        await this.evaluateRequestImpl({ expression: exp }).then(
          (result) => {
            const variable = (<EvalOut>result).Variable;
            v.children = variable.children;
          },
          (err) => this.logDelveError(err, 'Failed to evaluate expression')
        );
      }
    };
    // expressions passed to loadChildren defined per
    // https://github.com/go-delve/delve/blob/master/Documentation/api/ClientHowto.md#loading-more-of-a-variable
    if (
      vari.kind === GoReflectKind.Array ||
      vari.kind === GoReflectKind.Slice
    ) {
      variablesPromise = Promise.all(
        vari.children.map((v, i) => {
          return loadChildren(`*(*"${v.type}")(${v.addr})`, v).then(
            (): DebugProtocol.Variable => {
              const { result, variablesReference } =
                this.convertDebugVariableToProtocolVariable(v);
              return {
                name: '[' + i + ']',
                value: result,
                evaluateName: vari.fullyQualifiedName + '[' + i + ']',
                variablesReference,
              };
            }
          );
        })
      );
    } else if (vari.kind === GoReflectKind.Map) {
      variablesPromise = Promise.all(
        vari.children
          .map((_, i) => {
            // even indices are map keys, odd indices are values
            if (i % 2 === 0 && i + 1 < vari.children.length) {
              const mapKey = this.convertDebugVariableToProtocolVariable(
                vari.children[i]
              );
              return loadChildren(
                `${vari.fullyQualifiedName}.${vari.name}[${mapKey.result}]`,
                vari.children[i + 1]
              ).then(() => {
                const mapValue = this.convertDebugVariableToProtocolVariable(
                  vari.children[i + 1]
                );
                return {
                  name: mapKey.result,
                  value: mapValue.result,
                  evaluateName:
                    vari.fullyQualifiedName + '[' + mapKey.result + ']',
                  variablesReference: mapValue.variablesReference,
                };
              });
            }
          })
          .filter((v) => v != null) // remove the null values created by combining keys and values
      );
    } else {
      variablesPromise = Promise.all(
        vari.children.map((v) => {
          return loadChildren(`*(*"${v.type}")(${v.addr})`, v).then(
            (): DebugProtocol.Variable => {
              const { result, variablesReference } =
                this.convertDebugVariableToProtocolVariable(v);

              return {
                name: v.name,
                value: result,
                evaluateName: v.fullyQualifiedName,
                variablesReference,
              };
            }
          );
        })
      );
    }
    variablesPromise.then((variables) => {
      response.body = { variables };
      this.sendResponse(response);
      log('VariablesResponse', JSON.stringify(variables, null, ' '));
    });
  }

  protected continueRequest(response: DebugProtocol.ContinueResponse): void {
    log('ContinueRequest');
    this.continue();
    this.sendResponse(response);
    log('ContinueResponse');
  }

  protected nextRequest(response: DebugProtocol.NextResponse): void {
    this.nextEpoch++;
    const closureEpoch = this.nextEpoch;
    this.nextRequestRunning = true;

    log('NextRequest');
    this.delve.call<DebuggerState | CommandOut>(
      'Command',
      [{ name: 'next' }],
      (err, out) => {
        if (closureEpoch === this.continueEpoch) {
          this.nextRequestRunning = false;
        }

        if (err) {
          this.logDelveError(err, 'Failed to next');
        }
        const state = (<CommandOut>out).State;
        log('next state', state);
        this.debugState = state;
        this.handleReenterDebug('step');
      }
    );
    this.sendResponse(response);
    log('NextResponse');
  }

  protected stepInRequest(response: DebugProtocol.StepInResponse): void {
    this.nextEpoch++;
    const closureEpoch = this.nextEpoch;
    this.nextRequestRunning = true;

    log('StepInRequest');
    this.delve.call<DebuggerState | CommandOut>(
      'Command',
      [{ name: 'step' }],
      (err, out) => {
        if (closureEpoch === this.continueEpoch) {
          this.nextRequestRunning = false;
        }

        if (err) {
          this.logDelveError(err, 'Failed to step in');
        }
        const state = (<CommandOut>out).State;
        log('stop state', state);
        this.debugState = state;
        this.handleReenterDebug('step');
      }
    );
    this.sendResponse(response);
    log('StepInResponse');
  }

  protected stepOutRequest(response: DebugProtocol.StepOutResponse): void {
    this.nextEpoch++;
    const closureEpoch = this.nextEpoch;
    this.nextRequestRunning = true;

    log('StepOutRequest');
    this.delve.call<DebuggerState | CommandOut>(
      'Command',
      [{ name: 'stepOut' }],
      (err, out) => {
        if (closureEpoch === this.continueEpoch) {
          this.nextRequestRunning = false;
        }

        if (err) {
          this.logDelveError(err, 'Failed to step out');
        }
        const state = (<CommandOut>out).State;
        log('stepout state', state);
        this.debugState = state;
        this.handleReenterDebug('step');
      }
    );
    this.sendResponse(response);
    log('StepOutResponse');
  }

  protected pauseRequest(response: DebugProtocol.PauseResponse): void {
    log('PauseRequest');
    this.delve.call<DebuggerState | CommandOut>(
      'Command',
      [{ name: 'halt' }],
      (err, out) => {
        if (err) {
          this.logDelveError(err, 'Failed to halt');
          return this.sendErrorResponse(
            response,
            2010,
            'Unable to halt execution: "{e}"',
            {
              e: err.toString(),
            }
          );
        }
        const state = (<CommandOut>out).State;
        log('pause state', state);
        this.debugState = state;
        this.handleReenterDebug('pause');
      }
    );
    this.sendResponse(response);
    log('PauseResponse');
  }

  // evaluateRequest is used both for the traditional expression evaluation
  // (https://github.com/go-delve/delve/blob/master/Documentation/cli/expr.md) and
  // for the 'call' command support.
  // If the args.expression starts with the 'call' keyword followed by an expression that looks
  // like a function call, the request is interpreted as a 'call' command request,
  // and otherwise, interpreted as `print` command equivalent with RPCServer.Eval.
  protected evaluateRequest(
    response: DebugProtocol.EvaluateResponse,
    args: DebugProtocol.EvaluateArguments
  ): void {
    log('EvaluateRequest');
    // Captures pattern that looks like the expression that starts with `call<space>`
    // command call. This is supported only with APIv2.
    const isCallCommand = args.expression.match(/^\s*call\s+\S+/);
    if (isCallCommand) {
      this.evaluateCallImpl(args).then(
        (out) => {
          const state = (<CommandOut>out).State;
          const returnValues = state?.currentThread?.ReturnValues ?? [];
          switch (returnValues.length) {
            case 0:
              response.body = { result: '', variablesReference: 0 };
              break;
            case 1:
              response.body = this.convertDebugVariableToProtocolVariable(
                returnValues[0]
              );
              break;
            default:
              // Go function can return multiple return values while
              // DAP EvaluateResponse assumes a single result with possibly
              // multiple children. So, create a fake DebugVariable
              // that has all the results as children.
              const returnResults = this.wrapReturnVars(returnValues);
              response.body =
                this.convertDebugVariableToProtocolVariable(returnResults);
              break;
          }
          this.sendResponse(response);
          log('EvaluateCallResponse');
        },
        (err) => {
          this.sendErrorResponse(
            response,
            2009,
            'Unable to complete call: "{e}"',
            {
              e: err.toString(),
            },
            args.context === 'watch' ? null : ErrorDestination.User
          );
        }
      );
      return;
    }
    // Now handle it as a conventional evaluateRequest.
    this.evaluateRequestImpl(args).then(
      (out) => {
        const variable = (<EvalOut>out).Variable;
        // #2326: Set the fully qualified name for variable mapping
        variable.fullyQualifiedName = variable.name;
        response.body = this.convertDebugVariableToProtocolVariable(variable);
        this.sendResponse(response);
        log('EvaluateResponse');
      },
      (err) => {
        // No need to repeatedly show the error pop-up when expressions
        // are continiously reevaluated in the Watch panel, which
        // already displays errors.
        this.sendErrorResponse(
          response,
          2009,
          'Unable to eval expression: "{e}"',
          {
            e: err.toString(),
          },
          args.context === 'watch' ? null : ErrorDestination.User
        );
      }
    );
  }

  protected setVariableRequest(
    response: DebugProtocol.SetVariableResponse,
    args: DebugProtocol.SetVariableArguments
  ): void {
    log('SetVariableRequest');
    const scope = {
      goroutineID: this.debugState.currentGoroutine.id,
    };
    const setSymbolArgs = {
      Scope: scope,
      Symbol: args.name,
      Value: args.value,
    };
    this.delve.call('Set', [setSymbolArgs], (err) => {
      if (err) {
        const errMessage = `Failed to set variable: ${err.toString()}`;
        this.logDelveError(err, 'Failed to set variable');
        return this.sendErrorResponse(response, 2010, errMessage);
      }
      response.body = { value: args.value };
      this.sendResponse(response);
      log('SetVariableResponse');
    });
  }

  private getGOROOT(): string {
    if (this.delve && this.delve.goroot) {
      return this.delve.goroot;
    }
    return process.env['GOROOT'] || '';
    // this is a workaround to keep the tests in integration/goDebug.test.ts running.
    // The tests synthesize a bogus Delve instance.
  }

  // contains common code for launch debugging initialization
  private initLaunchRequest(
    response: DebugProtocol.LaunchResponse,
    args: LaunchRequestArguments
  ) {
    if (args.stopOnEntry) {
      this.stopOnEntry = args.stopOnEntry;
    }
    args.host = '127.0.0.1';
    args.port = random(2000, 50000);

    this.pathSeparator = findPathSeparator(args.repoRoot);
    this.substitutePath = [];

    if (args.substitutePath) {
      args.substitutePath.forEach((value) => {
        this.substitutePath.push({
          from: normalizeSeparators(value.from),
          to: normalizeSeparators(value.to),
        });
      });
    }

    // Launch the Delve debugger on the program
    this.delve = new Delve(args, args.target);
    this.delve.onstdout = (str: string) => {
      this.sendEvent(new OutputEvent(str, 'stdout'));
    };
    this.delve.onstderr = (str: string) => {
      this.sendEvent(new OutputEvent(str, 'stderr'));
    };
    this.delve.onclose = (code) => {
      if (code !== 0) {
        this.sendErrorResponse(
          response,
          3000,
          'Failed to continue: Check the debug console for details.'
        );
      }
      log('Sending TerminatedEvent as delve is closed');
      this.sendEvent(new TerminatedEvent());
    };

    this.delve.connection.then(
      () => {
        this.delve.call<GetVersionOut>('GetVersion', [], (err, out) => {
          if (err) {
            logError(err);
            return this.sendErrorResponse(
              response,
              2001,
              'Failed to get remote server version: "{e}"',
              { e: err.toString() }
            );
          }
          const clientVersion = 2;
          if (out.APIVersion !== clientVersion) {
            const errorMessage = `The remote server is running on delve v${out.APIVersion} API and the client is running v${clientVersion} API. Change the version used on the client by using the property "apiVersion" in your launch.json file.`;
            logError(errorMessage);
            return this.sendErrorResponse(response, 3000, errorMessage);
          }
        });

        this.sendEvent(new InitializedEvent());
        log('InitializeEvent');
        this.sendResponse(response);
      },
      (err) => {
        this.sendErrorResponse(response, 3000, 'Failed to continue: "{e}"', {
          e: err.toString(),
        });
        log('ContinueResponse');
      }
    );
  }

  private async setBreakPoints(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments
  ): Promise<void> {
    const file = normalizePath(args.source.path);
    if (!this.breakpoints.get(file)) {
      this.breakpoints.set(file, []);
    }
    const remoteFile = await this.toDebuggerPath(file);

    return Promise.all(
      this.breakpoints.get(file).map((existingBP) => {
        log('Clearing: ' + existingBP.id);
        return this.delve.callPromise('ClearBreakpoint', [
          { Id: existingBP.id },
        ]);
      })
    )
      .then(() => {
        log('All cleared');
        let existingBreakpoints: DebugBreakpoint[] | undefined;
        return Promise.all(
          args.breakpoints.map((breakpoint) => {
            log('Creating on: ' + file + ':' + breakpoint.line);
            const breakpointIn = <DebugBreakpoint>{};
            breakpointIn.file = remoteFile;
            breakpointIn.line = breakpoint.line;
            breakpointIn.loadArgs = this.delve.loadConfig;
            breakpointIn.loadLocals = this.delve.loadConfig;
            breakpointIn.cond = breakpoint.condition;
            return this.delve
              .callPromise('CreateBreakpoint', [{ Breakpoint: breakpointIn }])
              .then(null, async (err) => {
                // Delve does not seem to support error code at this time.
                // TODO(quoct): Follow up with delve team.
                if (err.toString().startsWith('Breakpoint exists at')) {
                  log('Encounter existing breakpoint: ' + breakpointIn);
                  // We need to call listbreakpoints to find the ID.
                  // Otherwise, we would not be able to clear the breakpoints.
                  if (!existingBreakpoints) {
                    try {
                      const listBreakpointsResponse =
                        await this.delve.callPromise<
                          ListBreakpointsOut | DebugBreakpoint[]
                        >('ListBreakpoints', [{}]);
                      existingBreakpoints = (
                        listBreakpointsResponse as ListBreakpointsOut
                      ).Breakpoints;
                    } catch (error) {
                      log('Error listing breakpoints: ' + error.toString());
                      return null;
                    }
                  }

                  // Make sure that we compare the file names with the same separators.
                  const matchedBreakpoint = existingBreakpoints.find(
                    (existingBreakpoint) =>
                      existingBreakpoint.line === breakpointIn.line &&
                      compareFilePathIgnoreSeparator(
                        existingBreakpoint.file,
                        breakpointIn.file
                      )
                  );

                  if (!matchedBreakpoint) {
                    log(
                      `Cannot match breakpoint ${breakpointIn} with existing breakpoints.`
                    );
                    return null;
                  }
                  return { Breakpoint: matchedBreakpoint };
                }
                log('Error on CreateBreakpoint: ' + err.toString());
                return null;
              });
          })
        );
      })
      .then((newBreakpoints) => {
        let convertedBreakpoints: DebugBreakpoint[];
        // Unwrap breakpoints from v2 apicall
        convertedBreakpoints = newBreakpoints.map((bp, i) => {
          return bp ? (bp as CreateBreakpointOut).Breakpoint : null;
        });

        log('All set:' + JSON.stringify(newBreakpoints));
        const breakpoints = convertedBreakpoints.map((bp, i) => {
          if (bp) {
            return { verified: true, line: bp.line };
          } else {
            return { verified: false, line: args.lines[i] };
          }
        });
        this.breakpoints.set(
          file,
          convertedBreakpoints.filter((x) => !!x)
        );
        return breakpoints;
      })
      .then(
        (breakpoints) => {
          response.body = { breakpoints };
          this.sendResponse(response);
          log('SetBreakPointsResponse');
        },
        (err) => {
          this.sendErrorResponse(
            response,
            2002,
            'Failed to set breakpoint: "{e}"',
            {
              e: err.toString(),
            }
          );
          logError(err);
        }
      );
  }

  private async getPackageInfo(
    debugState: DebuggerState
  ): Promise<string | void> {
    if (!debugState.currentThread || !debugState.currentThread.file) {
      return Promise.resolve(null);
    }
    const dir = path.dirname(debugState.currentThread.file);
    if (this.packageInfo.has(dir)) {
      return Promise.resolve(this.packageInfo.get(dir));
    }
    return new Promise((resolve) => {
      execFile(
        getBinPath('go'),
        ['list', '-f', '{{.Name}} {{.ImportPath}}'],
        { cwd: dir, env: process.env },
        (err, stdout, stderr) => {
          if (err || stderr || !stdout) {
            logError(`go list failed on ${dir}: ${stderr || err}`);
            return resolve();
          }
          if (stdout.split('\n').length !== 2) {
            logError(`Cannot determine package for ${dir}`);
            return resolve();
          }
          const spaceIndex = stdout.indexOf(' ');
          const result =
            stdout.substr(0, spaceIndex) === 'main'
              ? 'main'
              : stdout.substr(spaceIndex).trim();
          this.packageInfo.set(dir, result);
          resolve(result);
        }
      );
    });
  }

  // Go might return more than one result while DAP and VS Code do not support
  // such scenario but assume one single result. So, wrap all return variables
  // in one made-up, nameless, invalid variable. This is similar to how scopes
  // are represented. This assumes the vars are the ordered list of return
  // values from a function call.
  private wrapReturnVars(vars: DebugVariable[]): DebugVariable {
    // VS Code uses the value property of the DebugVariable
    // when displaying it. So let's formulate it in a user friendly way
    // as if they look like a list of multiple values.
    // Note: we use only convertDebugVariableToProtocolVariable's result,
    // which means we will leak the variable references until the handle
    // map is cleared. Assuming the number of return parameters is handful,
    // this waste shouldn't be significant.
    const values =
      vars.map((v) => this.convertDebugVariableToProtocolVariable(v).result) ||
      [];
    return {
      value: values.join(', '),
      kind: GoReflectKind.Invalid,
      flags:
        GoVariableFlags.VariableFakeAddress |
        GoVariableFlags.VariableReturnArgument,
      children: vars,

      // DebugVariable requires the following fields.
      name: '',
      addr: 0,
      type: '',
      realType: '',
      onlyAddr: false,
      DeclLine: 0,
      len: 0,
      cap: 0,
      unreadable: '',
      base: 0,
      fullyQualifiedName: '',
    };
  }

  private convertDebugVariableToProtocolVariable(v: DebugVariable): {
    result: string;
    variablesReference: number;
  } {
    if (v.kind === GoReflectKind.UnsafePointer) {
      return {
        result: `unsafe.Pointer(0x${v.children[0].addr.toString(16)})`,
        variablesReference: 0,
      };
    } else if (v.kind === GoReflectKind.Ptr) {
      if (v.children[0].addr === 0) {
        return {
          result: 'nil <' + v.type + '>',
          variablesReference: 0,
        };
      } else if (v.children[0].type === 'void') {
        return {
          result: 'void',
          variablesReference: 0,
        };
      } else {
        if (v.children[0].children.length > 0) {
          // Generate correct fullyQualified names for variable expressions
          v.children[0].fullyQualifiedName = v.fullyQualifiedName;
          v.children[0].children.forEach((child) => {
            child.fullyQualifiedName = v.fullyQualifiedName + '.' + child.name;
          });
        }
        return {
          result: `<${v.type}>(0x${v.children[0].addr.toString(16)})`,
          variablesReference:
            v.children.length > 0 ? this.variableHandles.create(v) : 0,
        };
      }
    } else if (v.kind === GoReflectKind.Slice) {
      if (v.base === 0) {
        return {
          result: 'nil <' + v.type + '>',
          variablesReference: 0,
        };
      }
      return {
        result: '<' + v.type + '> (length: ' + v.len + ', cap: ' + v.cap + ')',
        variablesReference: this.variableHandles.create(v),
      };
    } else if (v.kind === GoReflectKind.Map) {
      if (v.base === 0) {
        return {
          result: 'nil <' + v.type + '>',
          variablesReference: 0,
        };
      }
      return {
        result: '<' + v.type + '> (length: ' + v.len + ')',
        variablesReference: this.variableHandles.create(v),
      };
    } else if (v.kind === GoReflectKind.Array) {
      return {
        result: '<' + v.type + '>',
        variablesReference: this.variableHandles.create(v),
      };
    } else if (v.kind === GoReflectKind.String) {
      let val = v.value;
      const byteLength = Buffer.byteLength(val || '');
      if (v.value && byteLength < v.len) {
        val += `...+${v.len - byteLength} more`;
      }
      return {
        result: v.unreadable ? '<' + v.unreadable + '>' : '"' + val + '"',
        variablesReference: 0,
      };
    } else if (v.kind === GoReflectKind.Interface) {
      if (v.addr === 0) {
        // an escaped interface variable that points to nil, this shouldn't
        // happen in normal code but can happen if the variable is out of scope.
        return {
          result: 'nil',
          variablesReference: 0,
        };
      }

      if (v.children.length === 0) {
        // Shouldn't happen, but to be safe.
        return {
          result: 'nil',
          variablesReference: 0,
        };
      }
      const child = v.children[0];
      if (child.kind === GoReflectKind.Invalid && child.addr === 0) {
        return {
          result: `nil <${v.type}>`,
          variablesReference: 0,
        };
      }
      return {
        // TODO(hyangah): v.value will be useless. consider displaying more info from the child.
        // https://github.com/go-delve/delve/blob/930fa3b/service/api/prettyprint.go#L106-L124
        result: v.value || `<${v.type}(${child.type})>)`,
        variablesReference:
          v.children?.length > 0 ? this.variableHandles.create(v) : 0,
      };
    } else {
      // Default case - structs
      if (v.children.length > 0) {
        // Generate correct fullyQualified names for variable expressions
        v.children.forEach((child) => {
          child.fullyQualifiedName = v.fullyQualifiedName + '.' + child.name;
        });
      }
      return {
        result: v.value || '<' + v.type + '>',
        variablesReference:
          v.children.length > 0 ? this.variableHandles.create(v) : 0,
      };
    }
  }

  private cleanupHandles(): void {
    this.variableHandles.reset();
    this.stackFrameHandles.reset();
  }

  private handleReenterDebug(reason: string): void {
    log(`handleReenterDebug(${reason}).`);
    this.cleanupHandles();

    if (this.debugState.exited) {
      this.sendEvent(new TerminatedEvent());
      log('TerminatedEvent');
    } else {
      // Delve blocks on continue and does not support events, so there is no way to
      // refresh the list of goroutines while the program is running. And when the program is
      // stopped, the development tool will issue a threads request and update the list of
      // threads in the UI even without the optional thread events. Therefore, instead of
      // analyzing all goroutines here, only retrieve the current one.
      // TODO(polina): validate the assumption in this code that the first goroutine
      // is the current one. So far it appears to me that this is always the main goroutine
      // with id 1.
      this.delve.call<DebugGoroutine[] | ListGoroutinesOut>(
        'ListGoroutines',
        [{ count: 1 }],
        (err, out) => {
          if (err) {
            this.logDelveError(err, 'Failed to get threads');
          }
          const goroutines = (<ListGoroutinesOut>out).Goroutines;
          if (!this.debugState.currentGoroutine && goroutines.length > 0) {
            this.debugState.currentGoroutine = goroutines[0];
          }

          if (this.skipStopEventOnce) {
            log(
              `Skipping stop event for ${reason}. The current Go routines is ${this.debugState?.currentGoroutine}.`
            );
            this.skipStopEventOnce = false;
            return;
          }

          if (this.overrideStopReason?.length > 0) {
            reason = this.overrideStopReason;
            this.overrideStopReason = '';
          }

          const stoppedEvent = new StoppedEvent(
            reason,
            this.debugState.currentGoroutine.id
          );
          (<any>stoppedEvent.body).allThreadsStopped = true;
          this.sendEvent(stoppedEvent);
          log('StoppedEvent("' + reason + '")');
        }
      );
    }
  }

  // Returns true if the debuggee is running.
  // The call getDebugState is non-blocking so it should return
  // almost instantaneously. However, if we run into some errors,
  // we will fall back to the internal tracking of the debug state.
  // TODO: If Delve is not in multi-client state, we can simply
  // track the running state with continueRequestRunning internally
  // instead of issuing a getDebugState call to Delve. Perhaps we want to
  // do that to improve performance in the future.
  private async isDebuggeeRunning(): Promise<boolean> {
    if (this.debugState && this.debugState.exited) {
      return false;
    }
    try {
      this.debugState = await this.delve.getDebugState();
      return this.debugState.Running;
    } catch (error) {
      this.logDelveError(error, 'Failed to get state');
      // Fall back to the internal tracking.
      return this.continueRequestRunning || this.nextRequestRunning;
    }
  }

  private shutdownProtocolServer(
    response: DebugProtocol.DisconnectResponse,
    args: DebugProtocol.DisconnectArguments
  ): void {
    log('DisconnectRequest to parent to shut down protocol server.');
    super.disconnectRequest(response, args);
  }

  private continue(calledWhenSettingBreakpoint?: boolean): Thenable<void> {
    this.continueEpoch++;
    const closureEpoch = this.continueEpoch;
    this.continueRequestRunning = true;

    const callback = (out: any) => {
      if (closureEpoch === this.continueEpoch) {
        this.continueRequestRunning = false;
      }
      const state = (<CommandOut>out).State;
      log('continue state', state);
      this.debugState = state;

      let reason = 'breakpoint';
      // Check if the current thread was stopped on 'panic' or 'fatal error'.
      if (!!state.currentThread && !!state.currentThread.breakPoint) {
        const bp = state.currentThread.breakPoint;
        if (bp.id === unrecoveredPanicID) {
          // If the breakpoint is actually caused by a panic,
          // we want to return on "panic".
          reason = 'panic';
        } else if (bp.id === fatalThrowID) {
          // If the breakpoint is actually caused by a fatal throw,
          // we want to return on "fatal error".
          reason = 'fatal error';
        }
      }
      this.handleReenterDebug(reason);
    };

    // If called when setting breakpoint internally, we want the error to bubble up.
    let errorCallback = null;
    if (!calledWhenSettingBreakpoint) {
      errorCallback = (err: any) => {
        if (err) {
          this.logDelveError(err, 'Failed to continue');
        }
        this.handleReenterDebug('breakpoint');
        throw err;
      };
    }

    return this.delve
      .callPromise('Command', [{ name: 'continue' }])
      .then(callback, errorCallback);
  }

  // evaluateCallImpl expects args.expression starts with the 'call ' command.
  private evaluateCallImpl(
    args: DebugProtocol.EvaluateArguments
  ): Thenable<DebuggerState | CommandOut> {
    const callExpr = args.expression.trimLeft().slice('call '.length);
    // if args.frameID is 'not specified', expression is evaluated in the global scope, according to DAP.
    // default to the topmost stack frame of the current goroutine
    let goroutineId = -1;
    let frameId = 0;
    if (args.frameId) {
      [goroutineId, frameId] = this.stackFrameHandles.get(args.frameId, [
        goroutineId,
        frameId,
      ]);
    }
    // See https://github.com/go-delve/delve/blob/328cf87808822693dc611591519689dcd42696a3/service/api/types.go#L321-L350
    // for the command args for function call.
    const returnValue = this.delve
      .callPromise<DebuggerState | CommandOut>('Command', [
        {
          name: 'call',
          goroutineID: goroutineId,
          returnInfoLoadConfig: this.delve.loadConfig,
          expr: callExpr,
          unsafe: false,
        },
      ])
      .then(
        (val) => val,
        (err) => {
          logError(
            'Failed to call function: ',
            JSON.stringify(callExpr, null, ' '),
            '\n\rCall error:',
            err.toString()
          );
          return Promise.reject(err);
        }
      );
    return returnValue;
  }

  private evaluateRequestImpl(
    args: DebugProtocol.EvaluateArguments
  ): Thenable<EvalOut | DebugVariable> {
    // default to the topmost stack frame of the current goroutine
    let goroutineId = -1;
    let frameId = 0;
    // args.frameId won't be specified when evaluating global vars
    if (args.frameId) {
      [goroutineId, frameId] = this.stackFrameHandles.get(args.frameId, [
        goroutineId,
        frameId,
      ]);
    }
    const scope = {
      goroutineID: goroutineId,
      frame: frameId,
    };
    const evalSymbolArgs = {
      Expr: args.expression,
      Scope: scope,
      Cfg: this.delve.loadConfig,
    };
    const returnValue = this.delve
      .callPromise<EvalOut | DebugVariable>('Eval', [evalSymbolArgs])
      .then(
        (val) => val,
        (err) => {
          log(
            'Failed to eval expression: ',
            JSON.stringify(evalSymbolArgs, null, ' '),
            '\n\rEval error:',
            err.toString()
          );
          return Promise.reject(err);
        }
      );
    return returnValue;
  }

  private addFullyQualifiedName(variables: DebugVariable[]) {
    variables.forEach((local) => {
      local.fullyQualifiedName = local.name;
      local.children.forEach((child) => {
        child.fullyQualifiedName = local.name;
      });
    });
  }

  private logDelveError(err: any, message: string) {
    if (err === undefined) {
      return;
    }

    let errorMessage = err.toString();
    // Use a more user friendly message for an unpropagated SIGSEGV (EXC_BAD_ACCESS)
    // signal that delve is unable to send back to the target process to be
    // handled as a panic.
    // https://github.com/microsoft/vscode-go/issues/1903#issuecomment-460126884
    // https://github.com/go-delve/delve/issues/852
    // This affects macOS only although we're agnostic of the OS at this stage.
    if (errorMessage === 'bad access') {
      // Reuse the panic message from the Go runtime.
      errorMessage =
        'runtime error: invalid memory address or nil pointer dereference [signal SIGSEGV: segmentation violation]\nUnable to propogate EXC_BAD_ACCESS signal to target process and panic (see https://github.com/go-delve/delve/issues/852)';
    }

    logError(message + ' - ' + errorMessage);
    this.dumpStacktrace();
  }

  private async dumpStacktrace() {
    // Get current goroutine
    // Debugger may be stopped at this point but we still can (and need) to obtain state and stacktrace
    let goroutineId = 0;
    try {
      this.debugState = await this.delve.getDebugState();
      // In some fault scenarios there may not be a currentGoroutine available from the debugger state
      // Use the current thread
      if (!this.debugState.currentGoroutine) {
        goroutineId = this.debugState.currentThread.goroutineID;
      } else {
        goroutineId = this.debugState.currentGoroutine.id;
      }
    } catch (error) {
      logError('dumpStacktrace - Failed to get debugger state ' + error);
    }

    // Get goroutine stacktrace
    const stackTraceIn = {
      id: goroutineId,
      depth: this.delve.stackTraceDepth,
      full: false,
      cfg: this.delve.loadConfig,
    };
    this.delve.call<DebugLocation[] | StacktraceOut>(
      'Stacktrace',
      [stackTraceIn],
      (err, out) => {
        if (err) {
          logError('dumpStacktrace: Failed to produce stack trace' + err);
          return;
        }
        const locations = (<StacktraceOut>out).Locations;
        log('locations', locations);
        const stackFrames = locations.map((location, frameId) => {
          const uniqueStackFrameId = this.stackFrameHandles.create([
            goroutineId,
            frameId,
          ]);
          return new StackFrame(
            uniqueStackFrameId,
            location.function ? location.function.name : '<unknown>',
            location.file === '<autogenerated>'
              ? null
              : new Source(
                  path.basename(location.file),
                  this.toLocalPath(location.file)
                ),
            location.line,
            0
          );
        });

        // Dump stacktrace into error logger
        logError(
          `Last known immediate stacktrace (goroutine id ${goroutineId}):`
        );
        let output = '';
        stackFrames.forEach((stackFrame) => {
          output = output.concat(
            `\t${stackFrame.source.path}:${stackFrame.line}\n`
          );
          if (stackFrame.name) {
            output = output.concat(`\t\t${stackFrame.name}\n`);
          }
        });
        logError(output);
      }
    );
  }
}

export function random(low: number, high: number): number {
  return Math.floor(Math.random() * (high - low) + low);
}

async function removeFile(filePath: string): Promise<void> {
  try {
    const fileExists = await fsAccess(filePath)
      .then(() => true)
      .catch(() => false);
    if (filePath && fileExists) {
      await fsUnlink(filePath);
    }
  } catch (e) {
    logError(
      `Potentially failed remove file: ${filePath} - ${e.toString() || ''}`
    );
  }
}

// queryGOROOT returns `go env GOROOT`.
function queryGOROOT(cwd: any, env: any): Promise<string> {
  return new Promise<string>((resolve) => {
    execFile(
      getBinPath('go'),
      ['env', 'GOROOT'],
      { cwd, env },
      (err, stdout, stderr) => {
        if (err) {
          return resolve('');
        }
        return resolve(stdout.trim());
      }
    );
  });
}

DebugSession.run(GoDebugSession);
