#!/usr/bin/env node
/**
 * Zero-emoji gate.
 *
 * Emoji are forbidden anywhere in the Studio: they render differently on
 * every platform, they cannot inherit `currentColor`, and they break the
 * density of a professional tool. Every icon is a real SVG path from
 * `components/icons/NleIcons.tsx`.
 *
 * This script scans the Studio source (and, optionally, a live DOM dump)
 * for codepoints in the emoji ranges.
 *
 * Usage:
 *   node scripts/verify-no-emoji.cjs [--dom <file.html>]
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const STUDIO_SRC = path.join(ROOT, 'packages', 'studio', 'src');

/** Every package source tree that ships to a user. */
const SOURCE_ROOTS = [
  path.join(ROOT, 'packages', 'studio', 'src'),
  path.join(ROOT, 'packages', 'desktop', 'src'),
  path.join(ROOT, 'packages', 'core-engine', 'src'),
  path.join(ROOT, 'packages', 'scene-runtime', 'src'),
  path.join(ROOT, 'packages', 'scene-spec', 'src'),
  path.join(ROOT, 'packages', 'mcp-server', 'src'),
];

/**
 * The banned ranges.
 *
 *  - U+1F000–U+1FAFF: the pictographic planes (emoji proper)
 *  - U+2600–U+26FF : miscellaneous symbols (the sun, the umbrella, …)
 *  - U+2700–U+27BF : dingbats (the scissors, the check mark, …)
 *  - U+2B00–U+2BFF : miscellaneous symbols and arrows (decorative arrows)
 *  - U+FE0F      : the variation selector (makes a plain glyph an emoji)
 *  - U+1F1E6–U+1F1FF: regional indicators (flags)
 */
const RANGES = [
  [0x1f000, 0x1faff],
  [0x2600, 0x26ff],
  [0x2700, 0x27bf],
  [0x2b00, 0x2bff],
  [0x1f1e6, 0x1f1ff],
];

const SINGLE = new Set([0xfe0f, 0x200d, 0x20e3]);

function isBanned(codePoint) {
  if (SINGLE.has(codePoint)) return true;
  for (const [lo, hi] of RANGES) {
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
}

function scanText(text, label, hits) {
  let index = 0;
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (isBanned(cp)) {
      const line = text.slice(0, index).split('\n').length;
      hits.push({ file: label, line, char: char, codePoint: `U+${cp.toString(16).toUpperCase()}` });
    }
    index += char.length;
  }
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'out') continue;
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(tsx?|css|html|jsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const domIndex = args.indexOf('--dom');
  const hits = [];

  const files = [];
  for (const root of SOURCE_ROOTS) {
    if (!fs.existsSync(root)) continue;
    walk(root, files);
  }
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    scanText(content, path.relative(ROOT, file), hits);
  }

  if (domIndex !== -1 && args[domIndex + 1]) {
    const domFile = path.resolve(args[domIndex + 1]);
    if (fs.existsSync(domFile)) {
      scanText(fs.readFileSync(domFile, 'utf8'), path.relative(ROOT, domFile), hits);
    }
  }

  console.log(`[verify:no-emoji] scanned ${files.length} source file(s)`);
  if (hits.length === 0) {
    console.log('[verify:no-emoji] OK — zero emoji found');
    process.exit(0);
  }

  console.error(`[verify:no-emoji] FAIL — ${hits.length} emoji occurrence(s):`);
  for (const hit of hits) {
    console.error(`  ${hit.file}:${hit.line}  ${hit.char}  ${hit.codePoint}`);
  }
  process.exit(1);
}

main();
