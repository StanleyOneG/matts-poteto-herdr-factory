import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function missing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function checkoutRoot(directory: string): string | null {
  let current = directory;
  while (true) {
    const marker = join(current, ".git");
    let entry;
    try {
      entry = lstatSync(marker);
    } catch (error) {
      if (!missing(error)) throw error;
    }
    if (entry) {
      if (entry.isFile()) {
        const gitdir = /^gitdir: ([^\r\n]+)\r?\n?$/.exec(readFileSync(marker, "utf8"))?.[1];
        if (!gitdir || !statSync(realpathSync(resolve(current, gitdir))).isDirectory())
          throw new Error("Checkout Git directory identity is unavailable.");
      } else if (!entry.isDirectory()) {
        throw new Error("Checkout Git marker is not a directory or gitdir file.");
      }
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// Exclusion only: persisted context and session routes retain their original identity.
export function checkoutIdentity(context: string): string {
  const absolute = resolve(context);
  let canonical: string;
  try {
    canonical = realpathSync(absolute);
  } catch (error) {
    if (!missing(error)) throw error;
    // Compatibility for synthetic API/test contexts, not unresolved checkout aliases.
    let ancestor = absolute;
    while (true) {
      let entry;
      try {
        entry = lstatSync(ancestor);
      } catch (ancestorError) {
        if (!missing(ancestorError)) throw ancestorError;
      }
      if (entry) {
        if (!entry.isDirectory() || realpathSync(ancestor) !== ancestor || checkoutRoot(ancestor))
          throw new Error("Missing working directory cannot establish checkout identity.");
        return absolute;
      }
      ancestor = dirname(ancestor);
    }
  }
  if (!statSync(canonical).isDirectory())
    throw new Error("Working context is not a directory.");
  return checkoutRoot(canonical) ?? canonical;
}
