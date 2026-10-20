import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Path resolution for the custom privileged schemes.
 *
 * The Studio serves two custom protocols from the Electron main process:
 *
 *   `mf-runtime://app/index.html`  → the scene runtime bundle
 *   `mf-vault://logo.png`          → an asset in the engine's vault
 *
 * Both are `standard: true`, so `new URL()` parses them with a HOST and a
 * PATH. The naive implementation — join the pathname onto the root — breaks
 * in three ways:
 *
 *  1. **Windows separators.** A `%5C` inside the path decodes to a backslash,
 *     which `path.join` then treats as a separator on Windows but as an
 *     ordinary character on POSIX. The same URL would resolve to two
 *     different files depending on the host OS.
 *  2. **Traversal.** `mf-runtime://app/../../etc/passwd` resolves OUTSIDE the
 *     bundle root.
 *  3. **Drive letters.** The root may be `D:\Projects\...`; it must come from
 *     `path.resolve`, never from string concatenation.
 *
 * Everything here is a pure function so it can be unit-tested without
 * booting Electron.
 */

export interface PathResolution {
  /** the absolute path to serve, when the request is safe */
  filePath?: string;
  /** why the request was refused, when it was */
  error?: string;
}

/**
 * Split a URL path into decoded segments.
 *
 * Each segment is decoded on its own, so an encoded separator inside a
 * segment (`%2F`) can never introduce a new path component.
 */
export function decodePathSegments(pathname: string): string[] {
  return pathname
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        // a malformed escape is not a path we are willing to serve
        return "__invalid_escape__";
      }
    });
}

/**
 * Resolve decoded segments inside a root directory.
 *
 * Refuses anything that could escape the root, on any platform.
 */
export function resolveWithinRoot(root: string, segments: string[]): PathResolution {
  const safeRoot = path.resolve(root);

  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      return { error: `path segment "${segment}" is not allowed` };
    }
    if (segment.includes("/") || segment.includes("\\")) {
      return { error: `path segment "${segment}" contains a separator` };
    }
    if (segment.includes("\u0000")) {
      return { error: "path segment contains a null byte" };
    }
  }

  const filePath = path.resolve(safeRoot, ...segments);
  if (filePath !== safeRoot && !filePath.startsWith(safeRoot + path.sep)) {
    return { error: "resolved path escapes the served root" };
  }
  return { filePath };
}

/**
 * Resolve a `mf-runtime://` request.
 *
 * The URL's HOST is the mount point (`app`); the path is the file path inside
 * the runtime bundle. The WHATWG URL parser already collapses `..` segments
 * inside the path, and `resolveWithinRoot` refuses anything that could still
 * escape the root.
 */
export function resolveRuntimeRequest(runtimeRoot: string, url: URL): PathResolution {
  const segments = decodePathSegments(url.pathname);
  if (segments.length === 0) segments.push("index.html");
  return resolveWithinRoot(runtimeRoot, segments);
}

/**
 * Resolve a `mf-vault://` request.
 *
 * The vault is flat-ish, but a sub-folder (`_sfx/whoosh.ogg`) is legitimate,
 * so the host becomes the first segment of a relative path.
 */
export function resolveVaultRequest(vaultRoot: string, url: URL): PathResolution {
  const segments: string[] = [];
  if (url.hostname) segments.push(...decodePathSegments(url.hostname));
  segments.push(...decodePathSegments(url.pathname));
  if (segments.length === 0) {
    return { error: "empty vault path" };
  }
  return resolveWithinRoot(vaultRoot, segments);
}

/**
 * Pick the first existing runtime root from a candidate list.
 *
 * The candidates are ordered from the most specific (the packaged bundle
 * next to the executable) to the least specific (the repository layout), so
 * a packaged build never accidentally serves a stale development bundle.
 */
export function resolveRuntimeRoot(candidates: string[]): { root: string | null; tried: string[] } {
  const tried: string[] = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    tried.push(resolved);
    if (existsSync(resolved)) {
      return { root: resolved, tried };
    }
  }
  return { root: null, tried };
}
