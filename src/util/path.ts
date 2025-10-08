import path from "node:path";
import { pathToFileURL } from "node:url";

export const toAbsolutePath = (workspaceRoot: string, inputPath: string) => {
  const normalizedRoot = path.resolve(workspaceRoot);
  const candidate = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(normalizedRoot, inputPath);

  const relative = path.relative(normalizedRoot, candidate);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Resolved path ${candidate} escapes workspace root ${normalizedRoot}`,
    );
  }

  return candidate;
};

export const toFileUri = (absolutePath: string) =>
  pathToFileURL(absolutePath).toString();
