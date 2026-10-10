import { randomUUID } from "node:crypto";
import { openSync, writeFileSync, readFileSync, closeSync, fsyncSync, existsSync, lstatSync, realpathSync, linkSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
export function publish(path: string, value: unknown) {
  const bytes = JSON.stringify(value);
  const existing = () => {
    privateFile(path);
    if (readFileSync(path, "utf8") !== bytes)
      throw new Error("Immutable worker evidence conflicts. Preserve the existing file.");
  };
  if (existsSync(path)) {
    existing();
    return;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(temporary, path);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    existing();
  } finally {
    unlinkSync(temporary);
    const directory = openSync(dirname(path), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
}
export function privateFile(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || realpathSync(path) !== path)
    throw new Error("Managed bootstrap/evidence must be a private owned regular file without symlinks.");
  return JSON.parse(readFileSync(path, "utf8"));
}
