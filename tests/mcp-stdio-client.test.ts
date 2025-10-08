import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import { createConsoleLogger } from "../src/logger.js";
import { createTypeScriptLspServer } from "../src/server.js";
import { TypeScriptLspClient } from "../src/lsp/client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
const sampleFile = path.resolve(__dirname, "fixtures", "sample.ts");

class InMemoryStdioTransport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private readonly readBuffer = new ReadBuffer();

  constructor(
    private readonly input: PassThrough,
    private readonly output: PassThrough,
  ) {}

  async start(): Promise<void> {
    this.input.on("data", this.handleData);
    this.input.on("error", this.handleError);
  }

  async close(): Promise<void> {
    this.input.off("data", this.handleData);
    this.input.off("error", this.handleError);
    this.input.destroy();
    this.output.end();
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const payload = serializeMessage(message);
    if (!this.output.write(payload)) {
      await once(this.output, "drain");
    }
  }

  private handleData = (chunk: Buffer) => {
    try {
      this.readBuffer.append(chunk);
      let message: JSONRPCMessage | null;
      while ((message = this.readBuffer.readMessage()) !== null) {
        this.onmessage?.(message);
      }
    } catch (error) {
      this.onerror?.(error as Error);
    }
  };

  private handleError = (error: Error) => {
    this.onerror?.(error);
  };
}

describe("ts-lsp-mcp stdio integration", () => {
  test("hover and diagnostics tools respond over simulated stdio", async () => {
    const lspClient = new TypeScriptLspClient({
      workspacePath: workspaceRoot,
      logger: createConsoleLogger({ minimumLevel: "error" }),
    });

    await lspClient.initialize();

    const server = createTypeScriptLspServer({
      lspClient,
      workspacePath: workspaceRoot,
      logger: createConsoleLogger({ minimumLevel: "error" }),
    });

    const serverInput = new PassThrough();
    const serverOutput = new PassThrough();
    const clientInput = new PassThrough();
    const clientOutput = new PassThrough();

    serverOutput.on("data", (chunk) => {
      clientInput.write(chunk);
    });
    serverOutput.on("end", () => {
      clientInput.end();
    });

    clientOutput.on("data", (chunk) => {
      serverInput.write(chunk);
    });
    clientOutput.on("end", () => {
      serverInput.end();
    });

    const serverTransport = new StdioServerTransport(serverInput, serverOutput);
    const serverConnection = server.connect(serverTransport);

    const clientTransport = new InMemoryStdioTransport(clientInput, clientOutput);
    const client = new Client({
      name: "ts-lsp-mcp-test",
      version: "0.0.1",
    });

    await client.connect(clientTransport);

    const listToolsResult = await client.listTools();
    const toolNames = listToolsResult.tools.map((tool) => tool.name);

    expect(toolNames).toContain("typescript-hover");
    expect(toolNames).toContain("typescript-diagnostics");

    const source = await fs.readFile(sampleFile, "utf8");
    const hoverLine = source.split("\n")[0] ?? "";
    const character = hoverLine.indexOf("add");
    if (character === -1) {
      throw new Error("Failed to locate symbol 'add' in sample fixture.");
    }

    const relativeSamplePath = path.relative(workspaceRoot, sampleFile);

    const hover = await client.callTool({
      name: "typescript-hover",
      arguments: {
        filePath: relativeSamplePath,
        line: 0,
        character,
      },
    });

    const hoverText = hover.content?.find(
      (entry): entry is { type: "text"; text: string } => entry.type === "text",
    )?.text;

    expect(hoverText).toBeDefined();
    expect(hoverText).toContain("function add");

    const diagnostics = await client.callTool({
      name: "typescript-diagnostics",
      arguments: {
        filePath: relativeSamplePath,
      },
    });

    const diagnosticsText = diagnostics.content?.find(
      (entry): entry is { type: "text"; text: string } => entry.type === "text",
    )?.text;

    expect(diagnosticsText).toBeDefined();
    expect(diagnosticsText).toContain("No diagnostics reported");

    await client.close();
    await clientTransport.close();
    await server.close();
    await serverConnection;
    await lspClient.shutdown();
  }, 20000);
});
