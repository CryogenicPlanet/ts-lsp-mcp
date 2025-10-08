import path from "node:path";
import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Logger } from "./logger.js";
import { createConsoleLogger } from "./logger.js";
import { TypeScriptLspClient } from "./lsp/client.js";
import {
  formatDocumentSymbolsReport,
  formatDiagnosticsReport,
  formatHoverResult,
  formatLocationList,
} from "./util/formatter.js";
import { toAbsolutePath } from "./util/path.js";

export interface CreateTypeScriptServerOptions {
  lspClient: TypeScriptLspClient;
  workspacePath: string;
  logger?: Logger;
}

const positionSchema = {
  filePath: z
    .string()
    .min(1, "Provide a file path relative to the workspace root."),
  line: z
    .number()
    .int()
    .min(0, "Use zero-based line numbers."),
  character: z
    .number()
    .int()
    .min(0, "Use zero-based character offsets."),
};

const fileInputSchema = {
  filePath: z
    .string()
    .min(1, "Provide a file path relative to the workspace root."),
};

const referencesInputSchema = {
  ...positionSchema,
  includeDeclaration: z
    .boolean()
    .optional()
    .describe("Whether to include the declaration in the results."),
};

const toDisplayFile = (workspaceRoot: string, absoluteFilePath: string) => {
  const relative = path.relative(workspaceRoot, absoluteFilePath);
  if (!relative || relative.startsWith("..")) {
    return absoluteFilePath;
  }

  return relative || ".";
};

export const TOOL_NAMES = {
  hover: "typescript-hover",
  definition: "typescript-definition",
  references: "typescript-references",
  documentSymbols: "typescript-document-symbols",
  diagnostics: "typescript-diagnostics",
} as const;

export const createTypeScriptLspServer = (
  options: CreateTypeScriptServerOptions,
) => {
  const { lspClient, workspacePath } = options;
  const logger = options.logger ?? createConsoleLogger();
  const root = path.resolve(workspacePath);

  const server = new McpServer(
    {
      name: "ts-lsp-mcp",
      version: "0.1.0",
    },
    {
      instructions:
        "Use these tools to interrogate the TypeScript language server. All file paths must live within the configured workspace root.",
    },
  );

  server.registerTool(
    TOOL_NAMES.hover,
    {
      title: "TypeScript hover information",
      description:
        "Return hover detail at the supplied file location using the tsgo TypeScript language server.",
      inputSchema: positionSchema,
    },
    async ({ filePath, line, character }) => {
      const absolutePath = toAbsolutePath(root, filePath);
      const displayPath = toDisplayFile(root, absolutePath);

      try {
        const hover = await lspClient.getHover(filePath, {
          line,
          character,
        });

        return {
          content: [
            {
              type: "text",
              text: formatHoverResult(hover, root, {
                filePath: displayPath,
                position: { line, character },
              }),
            },
          ],
        };
      } catch (error) {
        logger.log("error", "Hover request failed", {
          error,
          filePath,
          line,
          character,
        });
        throw error;
      }
    },
  );

  server.registerTool(
    TOOL_NAMES.definition,
    {
      title: "Jump to definition",
      description:
        "Locate the definition(s) for the symbol at the given position.",
      inputSchema: positionSchema,
    },
    async ({ filePath, line, character }) => {
      try {
        const locations = await lspClient.getDefinition(filePath, {
          line,
          character,
        });

        return {
          content: [
            {
              type: "text",
              text: formatLocationList("Definition", locations, root),
            },
          ],
        };
      } catch (error) {
        logger.log("error", "Definition request failed", {
          error,
          filePath,
          line,
          character,
        });
        throw error;
      }
    },
  );

  server.registerTool(
    TOOL_NAMES.references,
    {
      title: "Find references",
      description:
        "Return all references to the symbol at the supplied position.",
      inputSchema: referencesInputSchema,
    },
    async ({ filePath, line, character, includeDeclaration }) => {
      try {
        const locations = await lspClient.findReferences(filePath, {
          position: { line, character },
          context: { includeDeclaration: includeDeclaration ?? false },
        });

        return {
          content: [
            {
              type: "text",
              text: formatLocationList("Reference", locations, root),
            },
          ],
        };
      } catch (error) {
        logger.log("error", "References request failed", {
          error,
          filePath,
          line,
          character,
          includeDeclaration,
        });
        throw error;
      }
    },
  );

  server.registerTool(
    TOOL_NAMES.documentSymbols,
    {
      title: "Document symbols",
      description:
        "Return the hierarchical symbols available within a file.",
      inputSchema: fileInputSchema,
    },
    async ({ filePath }) => {
      try {
        const symbols = await lspClient.documentSymbols(filePath);

        return {
          content: [
            {
              type: "text",
              text: formatDocumentSymbolsReport(symbols, root),
            },
          ],
        };
      } catch (error) {
        logger.log("error", "Document symbols request failed", {
          error,
          filePath,
        });
        throw error;
      }
    },
  );

  server.registerTool(
    TOOL_NAMES.diagnostics,
    {
      title: "Latest diagnostics",
      description:
        "Fetch the current diagnostics for a file as reported by the language server.",
      inputSchema: fileInputSchema,
    },
    async ({ filePath }) => {
      try {
        const diagnostics = await lspClient.getDiagnostics(filePath);

        return {
          content: [
            {
              type: "text",
              text: formatDiagnosticsReport(diagnostics, root),
            },
          ],
        };
      } catch (error) {
        logger.log("error", "Diagnostics request failed", {
          error,
          filePath,
        });
        throw error;
      }
    },
  );

  return server;
};

export type { TypeScriptLspClient } from "./lsp/client.js";
