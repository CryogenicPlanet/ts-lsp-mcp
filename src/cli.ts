#!/usr/bin/env node

import path from "node:path";
import process from "node:process";

import { Command, Option } from "commander";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createTypeScriptLspServer } from "./server.js";
import { TypeScriptLspClient } from "./lsp/client.js";
import { createConsoleLogger, type LogLevel } from "./logger.js";

const program = new Command();

program
  .name("ts-lsp-mcp")
  .description(
    "Model Context Protocol server exposing the TypeScript LSP via the tsgo native compiler.",
  )
  .option(
    "--workspace <path>",
    "Workspace root directory to analyze",
    process.cwd(),
  )
  .option("--tsgo <path>", "Path to the tsgo executable", "tsgo")
  .option(
    "--tsgo-arg <value...>",
    "Additional arguments to pass through to `tsgo lsp`.",
  )
  .addOption(
    new Option("--log-level <level>", "Minimum console log level")
      .choices(["debug", "info", "warn", "error"])
      .default("info"),
  )
  .parse(process.argv);

type CliOptions = {
  workspace: string;
  tsgo: string;
  tsgoArg?: string[];
  logLevel: LogLevel;
};

const options = program.opts<CliOptions>();

const workspaceRoot = path.resolve(options.workspace);
const tsgoArgs = options.tsgoArg ?? [];
const logger = createConsoleLogger({ minimumLevel: options.logLevel });

const lspClient = new TypeScriptLspClient({
  workspacePath: workspaceRoot,
  tsgoPath: options.tsgo,
  tsgoArgs,
  logger,
});

const server = createTypeScriptLspServer({
  lspClient,
  workspacePath: workspaceRoot,
  logger,
});

const transport = new StdioServerTransport();

const shutdown = async (exitCode: number) => {
  logger.log("info", "Shutting down tsgo and MCP transport", { exitCode });

  await Promise.allSettled([
    (async () => {
      try {
        await lspClient.shutdown();
      } catch (error) {
        logger.log("warn", "Error during tsgo shutdown", { error });
      }
    })(),
    (async () => {
      try {
        await server.close();
      } catch (error) {
        logger.log("warn", "Error while closing MCP server", { error });
      }
    })(),
  ]);

  process.exit(exitCode);
};

process.on("SIGINT", () => {
  shutdown(0).catch((error) => {
    logger.log("error", "Failed to shutdown on SIGINT", { error });
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  shutdown(0).catch((error) => {
    logger.log("error", "Failed to shutdown on SIGTERM", { error });
    process.exit(1);
  });
});

process.on("unhandledRejection", (reason) => {
  logger.log("error", "Unhandled promise rejection", { reason });
  shutdown(1).catch(() => process.exit(1));
});

process.on("uncaughtException", (error) => {
  logger.log("error", "Uncaught exception", { error });
  shutdown(1).catch(() => process.exit(1));
});

const main = async () => {
  logger.log("info", "Initializing tsgo TypeScript language server", {
    workspace: workspaceRoot,
    tsgo: options.tsgo,
    tsgoArgs,
  });

  await lspClient.initialize();

  if (process.stdin.readable && typeof process.stdin.resume === "function") {
    process.stdin.resume();
  }

  logger.log("info", "Connecting MCP server over stdio");

  const waitForClose = new Promise<void>((resolve, reject) => {
    transport.onclose = () => {
      logger.log("info", "MCP connection closed");
      resolve();
    };

    transport.onerror = (error) => {
      logger.log("error", "Transport error", { error });
      reject(error instanceof Error ? error : new Error(String(error)));
    };
  });

  try {
    await server.connect(transport);
    await waitForClose;
    await shutdown(0);
  } catch (error) {
    logger.log("error", "MCP server exited with error", { error });
    await shutdown(1);
  }
};

main().catch((error) => {
  logger.log("error", "Fatal error while starting server", { error });
  shutdown(1).catch(() => process.exit(1));
});
