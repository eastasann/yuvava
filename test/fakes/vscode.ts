/**
 * A fake `vscode` module, just large enough to activate Navigator outside an
 * extension host. It lets the wiring — command registration, diagnostics,
 * status bar, failure paths — be tested without a display.
 */

export interface Recorded {
  readonly commands: Map<string, (...args: unknown[]) => unknown>;
  readonly warnings: string[];
  readonly infos: string[];
  readonly statusMessages: string[];
  readonly logs: string[];
  readonly documents: Map<string, string[]>;
  configuration: Record<string, unknown>;
  workspaceFolders: Array<{ uri: { fsPath: string }; name: string; index: number }> | undefined;
  secrets: Map<string, string>;
  nextWarningChoice: string | undefined;
  /** Answers queued for `showInputBox`, consumed in order. */
  inputBoxAnswers: Array<string | undefined>;
  /** Every set of items `showQuickPick` was given, in order. */
  quickPicks: unknown[][];
  /** Labels to choose from successive `showQuickPick` calls. */
  quickPickChoices: Array<string | undefined>;
  openedExternal: string[];
}

export const recorded: Recorded = {
  commands: new Map(),
  warnings: [],
  infos: [],
  statusMessages: [],
  logs: [],
  documents: new Map(),
  configuration: {},
  workspaceFolders: undefined,
  secrets: new Map(),
  nextWarningChoice: undefined,
  inputBoxAnswers: [],
  quickPicks: [],
  quickPickChoices: [],
  openedExternal: [],
};

export function reset(): void {
  recorded.commands.clear();
  recorded.warnings.length = 0;
  recorded.infos.length = 0;
  recorded.statusMessages.length = 0;
  recorded.logs.length = 0;
  recorded.documents.clear();
  recorded.configuration = {};
  recorded.workspaceFolders = undefined;
  recorded.secrets = new Map();
  recorded.nextWarningChoice = undefined;
  recorded.inputBoxAnswers.length = 0;
  recorded.quickPicks.length = 0;
  recorded.quickPickChoices.length = 0;
  recorded.openedExternal.length = 0;
}

export class Uri {
  private constructor(readonly fsPath: string) {}
  static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }
  static parse(value: string): Uri {
    return new Uri(value);
  }
  toString(): string {
    return this.fsPath;
  }
}

export class Position {
  constructor(readonly line: number, readonly character: number) {}
}

export class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
    this.start = new Position(startLine, startCharacter);
    this.end = new Position(endLine, endCharacter);
  }
}

export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 } as const;

export class Diagnostic {
  source?: string;
  code?: string;
  constructor(
    readonly range: Range,
    readonly message: string,
    readonly severity: number,
  ) {}
}

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;
export const QuickPickItemKind = { Separator: -1, Default: 0 } as const;
export const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 } as const;

export class DiagnosticCollection {
  readonly entries = new Map<string, Diagnostic[]>();
  disposed = false;
  set(uri: Uri, diagnostics: Diagnostic[]): void {
    this.entries.set(uri.fsPath, diagnostics);
  }
  delete(uri: Uri): void {
    this.entries.delete(uri.fsPath);
  }
  clear(): void {
    this.entries.clear();
  }
  dispose(): void {
    this.disposed = true;
  }
}

export const languages = {
  createDiagnosticCollection(_name: string): DiagnosticCollection {
    return new DiagnosticCollection();
  },
};

export const commands = {
  registerCommand(id: string, callback: (...args: unknown[]) => unknown) {
    recorded.commands.set(id, callback);
    return { dispose: () => recorded.commands.delete(id) };
  },
  executeCommand(id: string, ...args: unknown[]): unknown {
    const callback = recorded.commands.get(id);
    if (callback === undefined) {
      throw new Error(`command not registered: ${id}`);
    }
    return callback(...args);
  },
};

export const window = {
  activeTextEditor: undefined as { document: { uri: Uri } } | undefined,
  createOutputChannel(_name: string, _options?: unknown) {
    const log = (level: string, message: string): void => {
      recorded.logs.push(`${level}: ${message}`);
    };
    return {
      info: (message: string) => log('info', message),
      warn: (message: string) => log('warn', message),
      error: (message: string) => log('error', message),
      show: () => undefined,
      dispose: () => undefined,
    };
  },
  createStatusBarItem(_alignment: number, _priority?: number) {
    return {
      text: '',
      tooltip: undefined as string | undefined,
      command: undefined as string | undefined,
      show: () => undefined,
      hide: () => undefined,
      dispose: () => undefined,
    };
  },
  showWarningMessage(message: string, ..._items: string[]): Promise<string | undefined> {
    recorded.warnings.push(message);
    return Promise.resolve(recorded.nextWarningChoice);
  },
  showInformationMessage(message: string): Promise<undefined> {
    recorded.infos.push(message);
    return Promise.resolve(undefined);
  },
  showInputBox(_options?: unknown): Promise<string | undefined> {
    return Promise.resolve(recorded.inputBoxAnswers.shift());
  },
  showQuickPick<T extends { label: string }>(items: T[], _options?: unknown): Promise<T | undefined> {
    recorded.quickPicks.push(items);
    const wanted = recorded.quickPickChoices.shift();
    return Promise.resolve(wanted === undefined ? undefined : items.find((item) => item.label === wanted));
  },
  setStatusBarMessage(message: string, _timeout?: number) {
    recorded.statusMessages.push(message);
    return { dispose: () => undefined };
  },
  withProgress<T>(
    _options: unknown,
    task: (progress: unknown, token: { onCancellationRequested: (listener: () => void) => void }) => Promise<T>,
  ): Promise<T> {
    return task({ report: () => undefined }, { onCancellationRequested: () => undefined });
  },
};

export const env = {
  openExternal(uri: Uri): Promise<boolean> {
    recorded.openedExternal.push(uri.toString());
    return Promise.resolve(true);
  },
};

export const workspace = {
  get workspaceFolders() {
    return recorded.workspaceFolders;
  },
  getWorkspaceFolder(_uri: Uri) {
    return recorded.workspaceFolders?.[0];
  },
  getConfiguration(_section: string, _scope?: unknown) {
    return {
      get<T>(key: string, defaultValue?: T): T | undefined {
        const value = recorded.configuration[key];
        return (value === undefined ? defaultValue : value) as T | undefined;
      },
    };
  },
  openTextDocument(uri: Uri): Promise<{ lineCount: number; lineAt(index: number): { text: string } }> {
    const lines = recorded.documents.get(uri.fsPath);
    if (lines === undefined) {
      return Promise.reject(new Error(`cannot open ${uri.fsPath}`));
    }
    return Promise.resolve({
      lineCount: lines.length,
      lineAt: (index: number) => ({ text: lines[index] }),
    });
  },
};

export function makeExtensionContext(): {
  subscriptions: Array<{ dispose(): void }>;
  secrets: {
    get(key: string): Promise<string | undefined>;
    store(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
} {
  return {
    subscriptions: [],
    secrets: {
      get: (key: string) => Promise.resolve(recorded.secrets.get(key)),
      store: (key: string, value: string) => {
        recorded.secrets.set(key, value);
        return Promise.resolve();
      },
      delete: (key: string) => {
        recorded.secrets.delete(key);
        return Promise.resolve();
      },
    },
  };
}
