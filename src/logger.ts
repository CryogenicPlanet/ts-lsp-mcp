export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, message: string, details?: Record<string, unknown>): void;
}

const priority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface ConsoleLoggerOptions {
  minimumLevel?: LogLevel;
}

export const createConsoleLogger = (
  options: ConsoleLoggerOptions = {},
): Logger => {
  const minLevel = options.minimumLevel ?? "info";

  const write = (
    level: LogLevel,
    message: string,
    details?: Record<string, unknown>,
  ) => {
    const timestamp = new Date().toISOString();
    const parts = [
      timestamp,
      level.toUpperCase(),
      message,
      details ? JSON.stringify(details) : undefined,
    ].filter(Boolean);

    process.stderr.write(`${parts.join(" ")}\n`);
  };

  return {
    log(level, message, details) {
      if (priority[level] < priority[minLevel]) {
        return;
      }

      const payload =
        details && Object.keys(details).length > 0 ? details : undefined;

      write(level, message, payload);
    },
  };
};
