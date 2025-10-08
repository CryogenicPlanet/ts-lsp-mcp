import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Diagnostic,
  DocumentSymbol,
  Hover,
  Location,
  MarkedString,
  MarkupContent,
  Position,
  PublishDiagnosticsParams,
  Range,
  SymbolInformation,
} from "vscode-languageserver-protocol";

const DIAGNOSTIC_SEVERITY_LABELS: Record<number, string> = {
  1: "Error",
  2: "Warning",
  3: "Information",
  4: "Hint",
};

const SYMBOL_KIND_LABELS: Record<number, string> = {
  1: "File",
  2: "Module",
  3: "Namespace",
  4: "Package",
  5: "Class",
  6: "Method",
  7: "Property",
  8: "Field",
  9: "Constructor",
  10: "Enum",
  11: "Interface",
  12: "Function",
  13: "Variable",
  14: "Constant",
  15: "String",
  16: "Number",
  17: "Boolean",
  18: "Array",
  19: "Object",
  20: "Key",
  21: "Null",
  22: "Enum Member",
  23: "Struct",
  24: "Event",
  25: "Operator",
  26: "Type Parameter",
};

export const toDisplayPath = (workspaceRoot: string, uri: string) => {
  let filePath = uri;

  if (uri.startsWith("file://")) {
    try {
      filePath = fileURLToPath(uri);
    } catch {
      // Keep original URI if conversion fails.
    }
  }

  const relative = path.relative(workspaceRoot, filePath);
  if (!relative || relative === "") {
    return ".";
  }

  if (relative.startsWith("..")) {
    return filePath;
  }

  return relative;
};

export const formatPosition = (position: Position) =>
  `${position.line + 1}:${position.character + 1}`;

export const formatRange = (range: Range) =>
  `${formatPosition(range.start)}-${formatPosition(range.end)}`;

const formatDiagnostic = (diagnostic: Diagnostic, index: number) => {
  const severity = diagnostic.severity
    ? DIAGNOSTIC_SEVERITY_LABELS[diagnostic.severity] ??
      `Severity ${diagnostic.severity}`
    : "Severity unknown";

  const diagnosticCode = diagnostic.code;
  const code =
    typeof diagnosticCode === "string" || typeof diagnosticCode === "number"
      ? diagnosticCode.toString()
      : undefined;

  const source = diagnostic.source ? ` (${diagnostic.source})` : "";
  const codeLabel = code ? ` [${code}]` : "";
  const message = diagnostic.message.trim();
  const tags =
    diagnostic.tags && diagnostic.tags.length > 0
      ? ` tags: ${diagnostic.tags.join(", ")}`
      : "";

  return `${index + 1}. ${severity}${codeLabel}${source} at ${formatRange(
    diagnostic.range,
  )}${tags}\n   ${message}`;
};

const flattenHoverSegment = (segment: MarkedString | MarkupContent | string) => {
  if (typeof segment === "string") {
    return segment.trim();
  }

  if ("language" in segment) {
    const fence = segment.language || "";
    const value = segment.value.trim();
    return fence
      ? `\`\`\`${fence}\n${value}\n\`\`\``
      : `\`\`\`\n${value}\n\`\`\``;
  }

  if (segment.kind === "markdown") {
    return segment.value.trim();
  }

  return `\`\`\`\n${segment.value.trim()}\n\`\`\``;
};

const flattenHoverContents = (hover: Hover): string[] => {
  if (Array.isArray(hover.contents)) {
    return hover.contents
      .map((entry) => flattenHoverSegment(entry))
      .filter((text) => text.length > 0);
  }

  if (!hover.contents) {
    return [];
  }

  return [flattenHoverSegment(hover.contents)];
};

const formatDocumentSymbol = (
  symbol: DocumentSymbol,
  workspaceRoot: string,
  depth: number,
): string[] => {
  const indent = depth > 0 ? `${"  ".repeat(depth)}- ` : "- ";
  const detail = symbol.detail ? ` — ${symbol.detail}` : "";
  const kind =
    SYMBOL_KIND_LABELS[symbol.kind] ?? `Symbol kind ${symbol.kind ?? "?"}`;
  const rangeLabel = symbol.selectionRange
    ? formatRange(symbol.selectionRange)
    : symbol.range
    ? formatRange(symbol.range)
    : "range unknown";

  const line = `${indent}${kind} ${symbol.name}${detail} (${rangeLabel})`;

  const childLines =
    symbol.children?.flatMap((child) =>
      formatDocumentSymbol(child, workspaceRoot, depth + 1),
    ) ?? [];

  return [line, ...childLines];
};

const formatSymbolInformation = (
  symbol: SymbolInformation,
  workspaceRoot: string,
): string => {
  const kind =
    SYMBOL_KIND_LABELS[symbol.kind] ?? `Symbol kind ${symbol.kind ?? "?"}`;
  const location = `${toDisplayPath(
    workspaceRoot,
    symbol.location.uri,
  )}:${formatRange(symbol.location.range)}`;
  const container = symbol.containerName ? ` — in ${symbol.containerName}` : "";

  return `- ${kind} ${symbol.name}${container} (${location})`;
};

export const formatHoverResult = (
  hover: Hover | null,
  workspaceRoot: string,
  target: { filePath: string; position: Position },
) => {
  if (!hover) {
    return `No hover information found at ${target.filePath}:${formatPosition(target.position)}.`;
  }

  const segments = flattenHoverContents(hover);
  if (segments.length === 0) {
    return `Hover response was empty at ${target.filePath}:${formatPosition(target.position)}.`;
  }

  const rangeLabel = hover.range ? `\n\nRange: ${formatRange(hover.range)}` : "";
  const header = `Hover at ${target.filePath}:${formatPosition(target.position)}`;

  return `${header}\n\n${segments.join("\n\n")}${rangeLabel}`;
};

export const formatLocationList = (
  kind: string,
  locations: Location[],
  workspaceRoot: string,
) => {
  if (!locations.length) {
    return `No ${kind} locations were returned.`;
  }

  const lines = locations.map((location, index) => {
    const displayPath = toDisplayPath(workspaceRoot, location.uri);
    const range = formatRange(location.range);
    return `${index + 1}. ${displayPath}:${range}`;
  });

  return `${kind} locations (${locations.length}):\n${lines.join("\n")}`;
};

export const formatDiagnosticsReport = (
  params: PublishDiagnosticsParams,
  workspaceRoot: string,
) => {
  const displayPath = toDisplayPath(workspaceRoot, params.uri);

  if (params.diagnostics.length === 0) {
    return `No diagnostics reported for ${displayPath}.`;
  }

  const lines = params.diagnostics.map((diagnostic, index) =>
    formatDiagnostic(diagnostic, index),
  );

  return `Diagnostics for ${displayPath} (${params.diagnostics.length}):\n${lines.join(
    "\n\n",
  )}`;
};

export const formatDocumentSymbolsReport = (
  symbols: Array<DocumentSymbol | SymbolInformation>,
  workspaceRoot: string,
) => {
  if (symbols.length === 0) {
    return "No document symbols available.";
  }

  const lines = symbols.flatMap((symbol) => {
    if ("location" in symbol) {
      return [formatSymbolInformation(symbol, workspaceRoot)];
    }

    return formatDocumentSymbol(symbol, workspaceRoot, 0);
  });

  return `Document symbols (${symbols.length}):\n${lines.join("\n")}`;
};

export const serializeLocations = (locations: Location[], workspaceRoot: string) =>
  locations.map((location) => ({
    uri: location.uri,
    path: toDisplayPath(workspaceRoot, location.uri),
    range: {
      start: {
        line: location.range.start.line,
        character: location.range.start.character,
      },
      end: {
        line: location.range.end.line,
        character: location.range.end.character,
      },
    },
  }));

export const serializeDiagnostics = (
  params: PublishDiagnosticsParams,
  workspaceRoot: string,
) => ({
  uri: params.uri,
  path: toDisplayPath(workspaceRoot, params.uri),
  diagnostics: params.diagnostics.map((diagnostic) => ({
    range: diagnostic.range,
    severity: diagnostic.severity
      ? DIAGNOSTIC_SEVERITY_LABELS[diagnostic.severity] ??
        diagnostic.severity.toString()
      : undefined,
    code:
      typeof diagnostic.code === "string" ||
      typeof diagnostic.code === "number"
        ? diagnostic.code
        : undefined,
    source: diagnostic.source,
    message: diagnostic.message,
    tags: diagnostic.tags,
    relatedInformation: diagnostic.relatedInformation,
  })),
});
