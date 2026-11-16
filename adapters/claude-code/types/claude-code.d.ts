// The part of Claude Code's hooks API that wake.ts and now.ts use, so lint and the editor resolve 'claude-code' on any
// checkout. Claude Code writes the full declarations into .claude-plugin/types/ only when it loads this folder as a
// plugin (--plugin-dir); they are not committed. Shapes follow Claude Code 2.1.322; `claude plugin validate
// adapters/claude-code` checks the modules against the engine itself.

export type ProcessSpawnChunk = { stream: 'stdout' | 'stderr'; text: string };
export type ProcessSpawnResult = { code: number | null; signal: string | null };
export type HookStream<C, R> = AsyncGenerator<C, R> & { readonly result: Promise<R> };

export interface EngineInterface {
  clock: { now(): Promise<number>; sleep(ms: number): Promise<void> };
  env: { get(name: string): Promise<string | null | undefined> };
  fs: { read(path: string): Promise<string> };
  http: {
    fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<unknown>;
  };
  plugin: { root: string };
  process: {
    spawn(o: { argv: string[]; env?: Record<string, string> }): HookStream<ProcessSpawnChunk, ProcessSpawnResult>;
  };
  prompt: { submit(o: { text: string }): Promise<unknown> };
  session: { id(): Promise<string> };
  ui: { log(text: string, o?: { to?: 'debug' | 'transcript' }): void };
}

export interface ToolCallInput {
  tool: string;
}

type Events = {
  'session.start': { isInteractive: boolean };
  'session.attach': { surface: 'terminal' | 'desktop' | 'vscode' | 'mobile' };
  'session.end': { reason: string };
  'tool.call': ToolCallInput;
};

export type On = <K extends keyof Events>(
  event: K,
  hook: ($: EngineInterface, e: Events[K], next: (e: Events[K]) => Promise<unknown>) => unknown,
) => void;

export type Register = (on: On, options: unknown) => unknown;
