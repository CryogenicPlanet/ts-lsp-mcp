import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createMessageConnection,
  type MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";
import {
  type ClientCapabilities,
  DocumentSymbolRequest,
  type DocumentSymbol,
  type Hover,
  HoverRequest,
  DefinitionRequest,
  InitializeRequest,
  InitializedNotification,
  type InitializeResult,
  type Location,
  type LocationLink,
  type Position,
  PublishDiagnosticsNotification,
  type PublishDiagnosticsParams,
  ReferencesRequest,
  type ReferenceParams,
  type SymbolInformation,
  type TextDocumentIdentifier,
  type TextDocumentItem,
  type VersionedTextDocumentIdentifier,
  type WorkspaceFolder,
  DidOpenTextDocumentNotification,
  DidChangeTextDocumentNotification,
  ShutdownRequest,
  ExitNotification,
} from "vscode-languageserver-protocol";

import type { Logger } from "../logger.js";
import { createConsoleLogger } from "../logger.js";
import { toAbsolutePath, toFileUri } from "../util/path.js";

export interface TypeScriptLspClientOptions {
  workspacePath: string;
  tsgoPath?: string;
  tsgoArgs?: string[];
  logger?: Logger;
  initializationTimeoutMs?: number;
  diagnosticsTimeoutMs?: number;
}

interface DocumentState {
  uri: string;
  path: string;
  version: number;
  text: string;
}

const DEFAULT_INITIALIZATION_TIMEOUT_MS = 10_000;
const DEFAULT_DIAGNOSTICS_TIMEOUT_MS = 1_500;

export class TypeScriptLspClient {
  private readonly workspaceRoot: string;
  private readonly logger: Logger;
  private readonly initializationTimeout: number;
  private readonly diagnosticsTimeout: number;

  private child: ChildProcessWithoutNullStreams | null = null;
  private connection: MessageConnection | null = null;
  private initializePromise: Promise<InitializeResult> | null = null;
  private shuttingDown = false;

  private readonly openDocuments = new Map<string, DocumentState>();
  private readonly diagnostics = new Map<string, PublishDiagnosticsParams>();
  private readonly diagnosticsEvents = new EventEmitter();

  constructor(private readonly options: TypeScriptLspClientOptions) {
    this.workspaceRoot = path.resolve(options.workspacePath);
    this.logger = options.logger ?? createConsoleLogger();
    this.initializationTimeout =
      options.initializationTimeoutMs ?? DEFAULT_INITIALIZATION_TIMEOUT_MS;
    this.diagnosticsTimeout =
      options.diagnosticsTimeoutMs ?? DEFAULT_DIAGNOSTICS_TIMEOUT_MS;
  }

  async initialize(): Promise<InitializeResult> {
    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.initializePromise = this.start();
    return this.initializePromise;
  }

  private async start(): Promise<InitializeResult> {
    const command = this.options.tsgoPath ?? "tsgo";
    const args = ["--lsp", "--stdio", ...(this.options.tsgoArgs ?? [])];

    this.logger.log("info", "Starting tsgo language server", {
      command,
      args,
      workspace: this.workspaceRoot,
    });

    const child = spawn(command, args, {
      cwd: this.workspaceRoot,
      env: {
        ...process.env,
        // Ensure TypeScript native preview module resolution matches the workspace.
        TSC_COMPILE_ON_ERROR: "true",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.on("exit", (code, signal) => {
      if (this.shuttingDown) {
        return;
      }

      this.logger.log("error", "tsgo process exited unexpectedly", {
        code,
        signal,
      });
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.logger.log("warn", "tsgo stderr output", { message: String(chunk) });
    });

    this.child = child;

    const reader = new StreamMessageReader(child.stdout);
    const writer = new StreamMessageWriter(child.stdin);

    const connection = createMessageConnection(reader, writer);
    this.connection = connection;

    connection.onNotification(
      PublishDiagnosticsNotification.method,
      (params: PublishDiagnosticsParams) => this.handleDiagnostics(params),
    );

    connection.onError((error: unknown) => {
      this.logger.log("error", "LSP connection error", { error });
    });

    connection.onClose(() => {
      this.logger.log("warn", "LSP connection closed");
    });

    connection.listen();

    const spawnErrorPromise = new Promise<never>((_, reject) => {
      child.once("error", (error) => {
        const message =
          error instanceof Error ? error.message : String(error);
        this.logger.log("error", "Failed to start tsgo process", {
          message,
        });
        reject(
          error instanceof Error ? error : new Error(`tsgo error: ${message}`),
        );
      });
    });

    const initializeResultPromise = connection.sendRequest<InitializeResult>(
      InitializeRequest.method,
      {
        processId: process.pid,
        rootUri: toFileUri(this.workspaceRoot),
        rootPath: this.workspaceRoot,
        capabilities: this.buildClientCapabilities(),
        clientInfo: {
          name: "ts-lsp-mcp",
          version: "0.1.0",
        },
        workspaceFolders: this.getWorkspaceFolders(),
      },
    );

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new Error(
            `Timed out after ${this.initializationTimeout}ms waiting for LSP initialize response`,
          ),
        );
      }, this.initializationTimeout);
    });

    const result = await Promise.race([
      initializeResultPromise,
      timeoutPromise,
      spawnErrorPromise,
    ]);

    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    await connection.sendNotification(InitializedNotification.method, {});

    this.logger.log("info", "tsgo language server initialized", {
      capabilities: result.capabilities,
    });

    return result;
  }

  private buildClientCapabilities(): ClientCapabilities {
    return {
      textDocument: {
        synchronization: {
          dynamicRegistration: false,
          willSave: false,
          willSaveWaitUntil: false,
          didSave: false,
        },
        hover: {
          dynamicRegistration: false,
        },
        definition: {
          dynamicRegistration: false,
        },
        references: {
          dynamicRegistration: false,
        },
        documentSymbol: {
          dynamicRegistration: false,
        },
      },
      workspace: {
        workspaceFolders: true,
      },
      general: {
        positionEncodings: ["utf-16"],
      },
    };
  }

  private getWorkspaceFolders(): WorkspaceFolder[] {
    const uri = toFileUri(this.workspaceRoot);
    return [
      {
        uri,
        name: path.basename(this.workspaceRoot),
      },
    ];
  }

  private assertConnection(): MessageConnection {
    if (!this.connection) {
      throw new Error("LSP connection has not been initialized");
    }

    return this.connection;
  }

  private async ensureDocument(
    filePath: string,
  ): Promise<{ state: DocumentState; identifier: TextDocumentIdentifier }> {
    const absolutePath = toAbsolutePath(this.workspaceRoot, filePath);
    const uri = toFileUri(absolutePath);
    const text = await fs.readFile(absolutePath, "utf8");

    const existing = this.openDocuments.get(uri);

    if (!existing) {
      const textDocument: TextDocumentItem = {
        uri,
        languageId: this.resolveLanguageId(absolutePath),
        version: 1,
        text,
      };

      this.assertConnection().sendNotification(
        DidOpenTextDocumentNotification.method,
        { textDocument },
      );

      const state: DocumentState = {
        uri,
        path: absolutePath,
        version: 1,
        text,
      };

      this.openDocuments.set(uri, state);
      return { state, identifier: { uri } };
    }

    if (existing.text !== text) {
      const nextVersion = existing.version + 1;
      const textDocument: VersionedTextDocumentIdentifier = {
        uri,
        version: nextVersion,
      };

      this.assertConnection().sendNotification(
        DidChangeTextDocumentNotification.method,
        {
          textDocument,
          contentChanges: [{ text }],
        },
      );

      existing.text = text;
      existing.version = nextVersion;
    }

    return { state: existing, identifier: { uri } };
  }

  private resolveLanguageId(absolutePath: string): string {
    if (absolutePath.endsWith(".tsx")) {
      return "typescriptreact";
    }

    if (absolutePath.endsWith(".jsx")) {
      return "javascriptreact";
    }

    if (
      absolutePath.endsWith(".js") ||
      absolutePath.endsWith(".cjs") ||
      absolutePath.endsWith(".mjs")
    ) {
      return "javascript";
    }

    if (
      absolutePath.endsWith(".cts") ||
      absolutePath.endsWith(".mts") ||
      absolutePath.endsWith(".d.cts") ||
      absolutePath.endsWith(".d.mts")
    ) {
      return "typescript";
    }

    return "typescript";
  }

  private handleDiagnostics(params: PublishDiagnosticsParams) {
    this.diagnostics.set(params.uri, params);
    this.diagnosticsEvents.emit(params.uri, params);
  }

  async getHover(filePath: string, position: Position): Promise<Hover | null> {
    await this.initialize();

    const { identifier } = await this.ensureDocument(filePath);
    const response = await this.assertConnection().sendRequest<Hover | null>(
      HoverRequest.method,
      {
        textDocument: identifier,
        position,
      },
    );

    return response ?? null;
  }

  async getDefinition(
    filePath: string,
    position: Position,
  ): Promise<Location[]> {
    await this.initialize();

    const { identifier } = await this.ensureDocument(filePath);
    const result = await this.assertConnection().sendRequest<
      Location | Location[] | LocationLink[] | null
    >(DefinitionRequest.method, {
      textDocument: identifier,
      position,
    });

    return this.normalizeLocations(result);
  }

  async findReferences(
    filePath: string,
    params: Omit<ReferenceParams, "textDocument" | "position"> & {
      position: Position;
    },
  ): Promise<Location[]> {
    await this.initialize();

    const { identifier } = await this.ensureDocument(filePath);
    const result = await this.assertConnection().sendRequest<Location[] | null>(
      ReferencesRequest.method,
      {
        textDocument: identifier,
        position: params.position,
        context: params.context,
      },
    );

    return result ?? [];
  }

  async documentSymbols(
    filePath: string,
  ): Promise<Array<DocumentSymbol | SymbolInformation>> {
    await this.initialize();

    const { identifier } = await this.ensureDocument(filePath);
    const result =
      await this.assertConnection().sendRequest<
        Array<DocumentSymbol | SymbolInformation> | null
      >(DocumentSymbolRequest.method, {
        textDocument: identifier,
      });

    return result ?? [];
  }

  async getDiagnostics(filePath: string): Promise<PublishDiagnosticsParams> {
    await this.initialize();

    const { identifier } = await this.ensureDocument(filePath);
    const uri = identifier.uri;

    const cached = this.diagnostics.get(uri);
    if (cached) {
      return cached;
    }

    return new Promise<PublishDiagnosticsParams>((resolve) => {
      const timer = setTimeout(() => {
        this.diagnosticsEvents.off(uri, handler);
        resolve({
          uri,
          diagnostics: [],
        });
      }, this.diagnosticsTimeout);

      const handler = (params: PublishDiagnosticsParams) => {
        clearTimeout(timer);
        resolve(params);
      };

      this.diagnosticsEvents.once(uri, handler);
    });
  }

  async shutdown(): Promise<void> {
    if (!this.connection || !this.child) {
      return;
    }

    this.shuttingDown = true;

    try {
      await this.connection.sendRequest(ShutdownRequest.method);
      await this.connection.sendNotification(ExitNotification.method);
    } catch (error) {
      this.logger.log("warn", "Failed to send shutdown request", { error });
    }

    this.connection.dispose();
    this.connection = null;

    this.child.kill();
    this.child = null;
  }

  private normalizeLocations(
    input:
      | null
      | undefined
      | Location
      | Location[]
      | LocationLink[],
  ): Location[] {
    if (!input) {
      return [];
    }

    if (Array.isArray(input)) {
      return input.map((entry) =>
        this.isLocationLink(entry)
          ? {
              uri: entry.targetUri,
              range: entry.targetSelectionRange ?? entry.targetRange,
            }
          : (entry as Location),
      );
    }

    return [input];
  }

  private isLocationLink(value: unknown): value is LocationLink {
    return (
      typeof value === "object" &&
      value !== null &&
      "targetUri" in value &&
      typeof (value as LocationLink).targetUri === "string"
    );
  }
}
