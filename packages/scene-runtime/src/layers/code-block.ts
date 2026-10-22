import type { CodeBlockLayer, CodeBlockTheme } from "@motionforge/scene-spec";
import { CRISP_TEXT_CSS } from "../determinism.js";
import { clamp, num } from "./guards.js";
import type { LayerContext } from "./context.js";

/**
 * The `codeBlock` layer — a syntax-highlighted source snippet.
 *
 * WHY A HAND-WRITTEN TOKENISER: the whole point of a code slide is that the
 * code READS as code. A dependency-free scanner gives us that for the cost of
 * one regex pass over the source, with no bundle weight, no runtime that
 * could disagree between the preview and the render, and — crucially — no
 * network fetch whose absence would change the picture.
 *
 * The tokeniser is a PURE function of the source string, so the same source
 * always paints the same colours.
 *
 * NO EMOJI: the window chrome's "traffic lights" are CSS circles, never a
 * character (the repository has a zero-emoji gate).
 */

const MONO_STACK =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", "Courier New", monospace';

type TokenType = "plain" | "comment" | "string" | "number" | "keyword" | "punctuation";

interface Token {
  type: TokenType;
  text: string;
}

interface Theme {
  panelBg: string;
  panelBorder: string;
  chromeBg: string;
  chromeText: string;
  gutterText: string;
  plain: string;
  keyword: string;
  string: string;
  number: string;
  comment: string;
  punctuation: string;
  highlightBg: string;
  dots: [string, string, string];
}

const THEMES: Record<CodeBlockTheme, Theme> = {
  dark: {
    panelBg: "#12141c",
    panelBorder: "#2b313d",
    chromeBg: "#191d27",
    chromeText: "#8b949e",
    gutterText: "#4d5560",
    plain: "#e6edf3",
    keyword: "#ff7b72",
    string: "#a5d6ff",
    number: "#79c0ff",
    comment: "#6e7681",
    punctuation: "#c9d1d9",
    highlightBg: "rgba(56,189,248,0.14)",
    dots: ["#ff5f57", "#febc2e", "#28c840"],
  },
  midnight: {
    panelBg: "#0b1020",
    panelBorder: "#1d2a49",
    chromeBg: "#101a33",
    chromeText: "#7f92b8",
    gutterText: "#3d4d70",
    plain: "#d7e0f0",
    keyword: "#c792ea",
    string: "#c3e88d",
    number: "#f78c6c",
    comment: "#4f6a8a",
    punctuation: "#89ddff",
    highlightBg: "rgba(199,146,234,0.16)",
    dots: ["#ff5f57", "#febc2e", "#28c840"],
  },
  matrix: {
    panelBg: "#04140a",
    panelBorder: "#0e3b1d",
    chromeBg: "#071a0e",
    chromeText: "#2f7a4a",
    gutterText: "#1f6b3a",
    plain: "#d7ffe0",
    keyword: "#39ff14",
    string: "#00ff9c",
    number: "#7fffd4",
    comment: "#1f7a3d",
    punctuation: "#9dffce",
    highlightBg: "rgba(57,255,20,0.14)",
    dots: ["#ff5f57", "#febc2e", "#28c840"],
  },
};

const C_LIKE_KEYWORDS = new Set([
  "abstract", "any", "as", "async", "await", "boolean", "break", "case", "catch", "class", "const",
  "continue", "debugger", "declare", "default", "delete", "do", "else", "enum", "export", "extends",
  "false", "finally", "for", "from", "function", "get", "if", "implements", "import", "in",
  "infer", "instanceof", "interface", "is", "keyof", "let", "namespace", "never", "new", "null",
  "number", "of", "package", "private", "protected", "public", "readonly", "return", "satisfies",
  "set", "static", "string", "super", "switch", "symbol", "this", "throw", "true", "try", "type",
  "typeof", "undefined", "unknown", "var", "void", "while", "with", "yield",
]);

const PYTHON_KEYWORDS = new Set([
  "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif",
  "else", "except", "False", "finally", "for", "from", "global", "if", "import", "in", "is",
  "lambda", "None", "nonlocal", "not", "or", "pass", "raise", "return", "self", "True", "try",
  "while", "with", "yield",
]);

const SHELL_KEYWORDS = new Set([
  "alias", "break", "case", "cd", "continue", "do", "done", "echo", "elif", "else", "esac", "exit",
  "export", "fi", "for", "function", "if", "in", "local", "printf", "read", "return", "set",
  "shift", "source", "then", "trap", "unset", "until", "while",
]);

interface LanguageProfile {
  keywords: ReadonlySet<string>;
  /** line-comment markers, longest first */
  lineComments: readonly string[];
  /** block-comment delimiters */
  blockComments: ReadonlyArray<readonly [string, string]>;
  /** quote characters that open a single-line string */
  quotes: readonly string[];
  /** backtick template strings */
  backtick: boolean;
}

const C_LIKE: LanguageProfile = {
  keywords: C_LIKE_KEYWORDS,
  lineComments: ["//"],
  blockComments: [["/*", "*/"]],
  quotes: ['"', "'"],
  backtick: true,
};

const PYTHON: LanguageProfile = {
  keywords: PYTHON_KEYWORDS,
  lineComments: ["#"],
  blockComments: [],
  quotes: ['"', "'"],
  backtick: false,
};

const SHELL: LanguageProfile = {
  keywords: SHELL_KEYWORDS,
  lineComments: ["#"],
  blockComments: [],
  quotes: ['"', "'"],
  backtick: false,
};

/**
 * The fallback profile: strings and numbers only.
 *
 * An unknown language must still LOOK like code — colouring the numbers and
 * the strings is enough — but it must never colour a word that happens to
 * be a keyword in some other language.
 */
const GENERIC: LanguageProfile = {
  keywords: new Set<string>(),
  lineComments: [],
  blockComments: [],
  quotes: ['"', "'"],
  backtick: false,
};

/** Pick the profile for a language name. */
export function profileFor(language: string): LanguageProfile {
  const name = language.trim().toLowerCase();
  if (name.length === 0) return GENERIC;
  if (name.includes("python") || name === "py") return PYTHON;
  if (name.includes("bash") || name.includes("shell") || name === "sh" || name === "zsh") return SHELL;
  if (
    name.includes("javascript") ||
    name.includes("typescript") ||
    name === "js" ||
    name === "jsx" ||
    name === "ts" ||
    name === "tsx" ||
    name.includes("java") ||
    name === "c" ||
    name === "cpp" ||
    name.includes("csharp") ||
    name === "go" ||
    name === "rust" ||
    name === "swift" ||
    name === "kotlin" ||
    name === "php" ||
    name === "scala" ||
    name === "dart" ||
    name === "json"
  ) {
    return C_LIKE;
  }
  return GENERIC;
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

/**
 * Split a source line into coloured tokens.
 *
 * A single left-to-right pass: comments, then strings, then numbers, then
 * identifiers (keyword or plain), then punctuation. Everything else stays
 * plain text.
 */
export function tokenizeLine(source: string, profile: LanguageProfile): Token[] {
  const tokens: Token[] = [];
  const n = source.length;
  let i = 0;
  let plainStart = 0;

  const flushPlain = (end: number): void => {
    if (end > plainStart) tokens.push({ type: "plain", text: source.slice(plainStart, end) });
  };

  while (i < n) {
    const ch = source[i]!;

    const lineMarker = profile.lineComments.find((m) => source.startsWith(m, i));
    if (lineMarker) {
      flushPlain(i);
      tokens.push({ type: "comment", text: source.slice(i) });
      i = n;
      plainStart = i;
      continue;
    }

    const blockMarker = profile.blockComments.find(([open]) => source.startsWith(open, i));
    if (blockMarker) {
      flushPlain(i);
      const close = source.indexOf(blockMarker[1], i + blockMarker[0].length);
      const stop = close === -1 ? n : close + blockMarker[1].length;
      tokens.push({ type: "comment", text: source.slice(i, stop) });
      i = stop;
      plainStart = i;
      continue;
    }

    if (profile.quotes.includes(ch) || (profile.backtick && ch === "`")) {
      flushPlain(i);
      let j = i + 1;
      while (j < n) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === ch) {
          j++;
          break;
        }
        j++;
      }
      const stop = Math.min(j, n);
      tokens.push({ type: "string", text: source.slice(i, stop) });
      i = stop;
      plainStart = i;
      continue;
    }

    if (DIGIT.test(ch) || (ch === "." && DIGIT.test(source[i + 1] ?? ""))) {
      flushPlain(i);
      let j = i;
      while (j < n && /[0-9a-fA-FxXoObB._]/.test(source[j]!)) j++;
      tokens.push({ type: "number", text: source.slice(i, j) });
      i = j;
      plainStart = i;
      continue;
    }

    if (IDENT_START.test(ch)) {
      flushPlain(i);
      let j = i;
      while (j < n && IDENT_PART.test(source[j]!)) j++;
      const word = source.slice(i, j);
      tokens.push({ type: profile.keywords.has(word) ? "keyword" : "plain", text: word });
      i = j;
      plainStart = i;
      continue;
    }

    if (!/\s/.test(ch)) {
      flushPlain(i);
      tokens.push({ type: "punctuation", text: ch });
      i++;
      plainStart = i;
      continue;
    }

    // whitespace: it stays inside the next plain run
    i++;
  }

  flushPlain(n);
  return tokens;
}

function colorFor(theme: Theme, type: TokenType): string {
  switch (type) {
    case "comment":
      return theme.comment;
    case "string":
      return theme.string;
    case "number":
      return theme.number;
    case "keyword":
      return theme.keyword;
    case "punctuation":
      return theme.punctuation;
    default:
      return theme.plain;
  }
}

export function renderCodeBlock(layer: CodeBlockLayer, ctx: LayerContext): { content: HTMLElement } {
  const widthPx = clamp(num(layer.widthPx, 880), 160, 2400);
  // `fontSize` is canonical; `fontSizePx` is the accepted alias (the
  // sanitizer folds one into the other, but a scene that skipped the
  // sanitizer still has to render).
  const fontSize = clamp(num(layer.fontSize, num(layer.fontSizePx, 22)), 8, 96);
  const theme = THEMES[layer.theme] ?? THEMES.dark;
  const profile = profileFor(typeof layer.language === "string" ? layer.language : "");
  const showChrome = layer.showChrome !== false;
  const showLineNumbers = layer.showLineNumbers !== false;
  const source = typeof layer.code === "string" ? layer.code : "";
  const title = typeof layer.title === "string" ? layer.title : "";
  const highlightLines = new Set(
    (Array.isArray(layer.highlightLines) ? layer.highlightLines : []).filter(
      (n): n is number => typeof n === "number" && Number.isFinite(n)
    )
  );

  const host = document.createElement("div");
  host.style.cssText = [
    "position:absolute",
    `left:${clamp(num(layer.position?.xPct, 50), -300, 300)}%`,
    `top:${clamp(num(layer.position?.yPct, 50), -300, 300)}%`,
    `width:${widthPx}px`,
    "max-width:100%",
    CRISP_TEXT_CSS,
  ].join(";");

  const panel = document.createElement("div");
  panel.style.cssText = [
    "position:relative",
    "width:100%",
    "box-sizing:border-box",
    `background:${theme.panelBg}`,
    `border:1px solid ${theme.panelBorder}`,
    "border-radius:14px",
    "overflow:hidden",
    "box-shadow:0 26px 60px rgba(0,0,0,0.42)",
    `font-family:${MONO_STACK}`,
  ].join(";");
  host.appendChild(panel);

  if (showChrome) {
    const chrome = document.createElement("div");
    chrome.style.cssText = [
      "position:relative",
      "display:flex",
      "align-items:center",
      "gap:10px",
      "height:40px",
      "padding:0 14px",
      `background:${theme.chromeBg}`,
      `border-bottom:1px solid ${theme.panelBorder}`,
      "box-sizing:border-box",
    ].join(";");
    panel.appendChild(chrome);

    // the traffic lights — CSS CIRCLES, never an emoji
    for (const dotColor of theme.dots) {
      const dot = document.createElement("span");
      dot.style.cssText = [
        "display:block",
        "flex:none",
        "width:11px",
        "height:11px",
        "border-radius:50%",
        `background:${dotColor}`,
        "opacity:0.92",
      ].join(";");
      chrome.appendChild(dot);
    }

    const chromeTitle = document.createElement("div");
    chromeTitle.style.cssText = [
      "position:absolute",
      "left:0",
      "right:0",
      "text-align:center",
      `font-family:${MONO_STACK}`,
      `font-size:${Math.max(11, Math.round(fontSize * 0.68))}px`,
      `color:${theme.chromeText}`,
      "pointer-events:none",
      "overflow:hidden",
      "text-overflow:ellipsis",
      "white-space:nowrap",
      "padding:0 84px",
      "box-sizing:border-box",
    ].join(";");
    chromeTitle.textContent = title;
    chrome.appendChild(chromeTitle);
  }

  const lines = source.split("\n");
  const gutterChars = String(Math.max(1, lines.length)).length;
  const gutterWidth = showLineNumbers ? Math.ceil(gutterChars * fontSize * 0.62) + fontSize * 1.1 : 0;

  const body = document.createElement("div");
  body.style.cssText = [
    "display:grid",
    `grid-template-columns:${gutterWidth}px 1fr`,
    `background:${theme.panelBg}`,
    "padding:12px 0",
    "box-sizing:border-box",
  ].join(";");
  panel.appendChild(body);

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const highlighted = highlightLines.has(lineNumber);

    const number = document.createElement("div");
    number.style.cssText = [
      `text-align:right`,
      `padding:0 ${Math.round(fontSize * 0.7)}px 0 ${Math.round(fontSize * 0.4)}px`,
      `font-size:${fontSize}px`,
      `line-height:${Math.round(fontSize * 1.55)}px`,
      `color:${highlighted ? theme.keyword : theme.gutterText}`,
      `background:${highlighted ? theme.highlightBg : "transparent"}`,
      "font-variant-numeric:tabular-nums",
      "user-select:none",
    ].join(";");
    number.textContent = showLineNumbers ? String(lineNumber) : "";
    body.appendChild(number);

    const code = document.createElement("div");
    code.style.cssText = [
      `padding:0 ${Math.round(fontSize * 0.9)}px 0 ${Math.round(fontSize * 0.5)}px`,
      `font-size:${fontSize}px`,
      `line-height:${Math.round(fontSize * 1.55)}px`,
      `background:${highlighted ? theme.highlightBg : "transparent"}`,
      "white-space:pre",
      "overflow:hidden",
      "min-width:0",
    ].join(";");
    for (const token of tokenizeLine(lines[i] ?? "", profile)) {
      const span = document.createElement("span");
      span.style.color = colorFor(theme, token.type);
      span.textContent = token.text;
      code.appendChild(span);
    }
    body.appendChild(code);
  }

  ctx.content.appendChild(host);
  return { content: host };
}
