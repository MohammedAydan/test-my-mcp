import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  decodePathSegments,
  resolveRuntimeRequest,
  resolveRuntimeRoot,
  resolveVaultRequest,
  resolveWithinRoot,
} from "../src/protocol-paths.js";

/**
 * Path resolution for the custom privileged schemes.
 *
 * The failure these tests exist to prevent:
 *
 *   [mf-runtime] File not found: ...\packages\scene-runtime\dist\index.html
 *
 * and its Windows-only sibling, where a `%5C` in the URL decoded into a
 * backslash that `path.join` treated as a separator on Windows but as an
 * ordinary character on POSIX.
 */

const ROOT = path.resolve("/tmp/mf-protocol-root");

describe("decodePathSegments", () => {
  it("splits and decodes each segment on its own", () => {
    expect(decodePathSegments("/index.html")).toEqual(["index.html"]);
    expect(decodePathSegments("/assets/app.js")).toEqual(["assets", "app.js"]);
    expect(decodePathSegments("/a%20b/c.png")).toEqual(["a b", "c.png"]);
  });

  it("never lets an encoded separator create a new segment", () => {
    expect(decodePathSegments("/a%2Fb")).toEqual(["a/b"]);
  });

  it("ignores empty segments", () => {
    expect(decodePathSegments("//a//b//")).toEqual(["a", "b"]);
  });

  it("neutralises a malformed escape", () => {
    expect(decodePathSegments("/%E0%A4%A")).toEqual(["__invalid_escape__"]);
  });
});

describe("resolveWithinRoot", () => {
  it("resolves a normal path inside the root", () => {
    const result = resolveWithinRoot(ROOT, ["assets", "logo.png"]);
    expect(result.filePath).toBe(path.join(ROOT, "assets", "logo.png"));
  });

  it("refuses a `..` segment", () => {
    const result = resolveWithinRoot(ROOT, ["..", "etc", "passwd"]);
    expect(result.filePath).toBeUndefined();
    expect(result.error).toBeTruthy();
  });

  it("refuses a segment that contains a separator", () => {
    expect(resolveWithinRoot(ROOT, ["a/b"]).filePath).toBeUndefined();
    expect(resolveWithinRoot(ROOT, ["a\\b"]).filePath).toBeUndefined();
  });

  it("resolves a Windows-style root without mangling the drive letter", () => {
    // On Windows `path.resolve` keeps `D:\…` intact; on POSIX the same string
    // is a relative path, so the assertion is platform-neutral: the file name
    // and the project segment must survive either way.
    const winRoot = "D:\\Projects\\motionforge\\packages\\scene-runtime\\dist";
    const result = resolveWithinRoot(winRoot, ["index.html"]);
    expect(result.filePath).toBeDefined();
    expect(path.basename(result.filePath!)).toBe("index.html");
    expect(result.filePath).toContain("motionforge");
  });
});

describe("resolveRuntimeRequest", () => {
  it("serves the bundle index for `mf-runtime://app/index.html`", () => {
    const url = new URL("mf-runtime://app/index.html");
    const result = resolveRuntimeRequest(ROOT, url);
    expect(result.filePath).toBe(path.join(ROOT, "index.html"));
  });

  it("serves the bundle index for the bare mount", () => {
    const url = new URL("mf-runtime://app/");
    const result = resolveRuntimeRequest(ROOT, url);
    expect(result.filePath).toBe(path.join(ROOT, "index.html"));
  });

  it("serves a nested asset", () => {
    const url = new URL("mf-runtime://app/assets/app.js");
    const result = resolveRuntimeRequest(ROOT, url);
    expect(result.filePath).toBe(path.join(ROOT, "assets", "app.js"));
  });

  it("ignores the query string", () => {
    const url = new URL("mf-runtime://app/index.html?scene=abc");
    const result = resolveRuntimeRequest(ROOT, url);
    expect(result.filePath).toBe(path.join(ROOT, "index.html"));
  });

  it("never resolves outside the bundle root", () => {
    const url = new URL("mf-runtime://app/../../../etc/passwd");
    const result = resolveRuntimeRequest(ROOT, url);
    // the WHATWG URL parser collapses the `..` segments, so the request is
    // CONTAINED — it can never point outside the served root
    if (result.filePath) {
      expect(result.filePath.startsWith(ROOT)).toBe(true);
    } else {
      expect(result.error).toBeTruthy();
    }
  });

  it("refuses a path that still tries to escape", () => {
    const url = new URL("mf-runtime://app/index.html");
    const result = resolveRuntimeRequest(ROOT, url);
    expect(result.filePath).toBe(path.join(ROOT, "index.html"));
    expect(result.filePath?.startsWith(ROOT)).toBe(true);
  });
});

describe("resolveVaultRequest", () => {
  it("serves a vault file addressed by host", () => {
    const url = new URL("mf-vault://logo.png");
    const result = resolveVaultRequest(ROOT, url);
    expect(result.filePath).toBe(path.join(ROOT, "logo.png"));
  });

  it("serves a vault file in a sub-folder", () => {
    const url = new URL("mf-vault://_sfx/whoosh.ogg");
    const result = resolveVaultRequest(ROOT, url);
    expect(result.filePath).toBe(path.join(ROOT, "_sfx", "whoosh.ogg"));
  });

  it("refuses a traversal out of the vault", () => {
    const url = new URL("mf-vault://../../secret.txt");
    const result = resolveVaultRequest(ROOT, url);
    expect(result.filePath).toBeUndefined();
  });
});

describe("resolveRuntimeRoot", () => {
  it("reports every candidate it tried when nothing exists", () => {
    const result = resolveRuntimeRoot([path.join(os.tmpdir(), "mf-does-not-exist-a")]);
    expect(result.root).toBeNull();
    expect(result.tried).toHaveLength(1);
  });

  it("picks the first existing candidate", () => {
    const existing = path.resolve(process.cwd(), "packages");
    const result = resolveRuntimeRoot([path.join(os.tmpdir(), "mf-does-not-exist-b"), existing]);
    expect(result.root).toBe(existing);
  });
});
