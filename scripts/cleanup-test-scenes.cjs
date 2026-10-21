#!/usr/bin/env node
/**
 * Remove the TEST scenes that the automated harnesses left behind.
 *
 * THE PROBLEM
 * -----------
 * The Electron harnesses used to launch the real desktop app with only
 * `MOTIONFORGE_TEST_MODE=1`, so the engine resolved its DEFAULT storage
 * (`~/.motionforge/scenes`) and every run WROTE ITS TEST SCENES INTO THE
 * USER'S WORKSPACE. The Project Bin's COMPOSITIONS list filled up with
 * leftovers ("Lock Probe", "Monitor Electron Smoke 1/2/3",
 * "Pro NLE Verification Dirty", "UX Verification h0dxso", …).
 *
 * (The harnesses now run against an isolated temporary tree — see
 * `scripts/lib/test-env.cjs` — so the residue stops growing. This script
 * removes what is already there.)
 *
 * THE SAFETY RULE
 * ---------------
 * A scene is deleted ONLY when it is unmistakably a test artifact:
 *
 *   (A) its ID starts with a known test prefix
 *       (`e2e-`, `ux-`, `test-`, `demo-mv`, `clamp-check`, `focus-void`,
 *        `sweep-test`), OR
 *   (B) its ID *and* its NAME both match a known test marker.
 *
 * A composition that merely looks like real user work — because its id and
 * its name do NOT both look like a test — is NEVER deleted, no matter what
 * its content is. Two scenes called "My Film" are the user's, not ours.
 *
 * USAGE
 * -----
 *   node scripts/cleanup-test-scenes.cjs                 # dry run (default)
 *   node scripts/cleanup-test-scenes.cjs --apply         # delete them
 *   node scripts/cleanup-test-scenes.cjs --dir <path>    # another store
 *
 * The default target is resolved EXACTLY like
 * `packages/core-engine/src/config.ts` does:
 *
 *   MOTIONFORGE_STORAGE_DIR → MOTIONFORGE_DATA_DIR/scenes → ~/.motionforge/scenes
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * The id prefixes the automated runs use. An id that starts with one of
 * these is a test artifact by construction.
 */
const TEST_ID_PREFIXES = [
  'e2e-',
  'ux-',
  'test-',
  'demo-mv',
  'clamp-check',
  'focus-void',
  'sweep-test',
];

/**
 * The markers a test scene carries. A multi-word marker matches as a
 * PHRASE ("pro nle verification" matches "pro-nle-verification"); a single
 * word matches only as a whole token, so "smoke" never matches "smoky".
 */
const TEST_MARKERS = [
  'lock probe',
  'monitor electron smoke',
  'pro nle verification',
  'ux verification',
  'smoke',
  'clamp-check',
  'focus-void',
  'sweep-test',
  'test',
  'e2e',
  'ux',
  'demo-mv',
];

/* ── argument parsing ───────────────────────────────────────────────────── */

function parseArgs(argv) {
  const options = { apply: false, dir: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--delete') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dir' || arg === '--target') options.dir = argv[++i] ?? null;
    else if (arg.startsWith('--dir=')) options.dir = arg.slice('--dir='.length);
    else if (arg.startsWith('--target=')) options.dir = arg.slice('--target='.length);
    else throw new Error(`Unknown argument "${arg}"`);
  }
  return options;
}

/* ── path resolution (mirrors packages/core-engine/src/config.ts) ───────── */

/**
 * The storage directory the engine uses when nothing overrides it.
 *
 * `MOTIONFORGE_STORAGE_DIR` wins, then `MOTIONFORGE_DATA_DIR/scenes`, then
 * the canonical `~/.motionforge/scenes`.
 */
function defaultStorageDir() {
  if (process.env.MOTIONFORGE_STORAGE_DIR) return process.env.MOTIONFORGE_STORAGE_DIR;
  const dataDir = process.env.MOTIONFORGE_DATA_DIR || path.join(os.homedir(), '.motionforge');
  return path.join(dataDir, 'scenes');
}

/* ── matching ───────────────────────────────────────────────────────────── */

/** Lower-case and collapse every run of non-alphanumerics into one dash. */
function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The dash-separated tokens of a value ("smoke test" → ["smoke", "test"]). */
function tokens(value) {
  return normalize(value).split('-').filter(Boolean);
}

/**
 * True when `value` carries the marker.
 *
 * A multi-word marker matches as a phrase; a single-word marker matches only
 * as a whole token.
 */
function matchesMarker(value, marker) {
  const haystack = normalize(value);
  const needle = normalize(marker);
  if (!needle) return false;
  if (needle.includes('-')) return haystack.includes(needle);
  return tokens(value).includes(needle);
}

/** The first marker the value carries, or null. */
function firstMarker(value, markers = TEST_MARKERS) {
  for (const marker of markers) {
    if (matchesMarker(value, marker)) return marker;
  }
  return null;
}

/**
 * Decide whether a scene is a test artifact.
 *
 * @param {{id: string, name: string}} scene
 * @returns {{isTest: boolean, reason: string}}
 */
function classifyScene(scene) {
  const id = normalize(scene.id);
  const name = normalize(scene.name);

  const prefix = TEST_ID_PREFIXES.find((p) => id.startsWith(normalize(p)));
  if (prefix) {
    return { isTest: true, reason: `the id starts with the test prefix "${prefix}"` };
  }

  const idMarker = firstMarker(scene.id);
  const nameMarker = firstMarker(scene.name);
  if (idMarker && nameMarker) {
    return {
      isTest: true,
      reason: `the id carries "${idMarker}" and the name carries "${nameMarker}"`,
    };
  }

  return {
    isTest: false,
    reason: 'the id and the name do not both look like a test artifact',
  };
}

/* ── the store ──────────────────────────────────────────────────────────── */

/**
 * Read the id and the name out of a scene file.
 *
 * The store writes an envelope (`{ schemaVersion, scene, revision, … }`) but
 * a legacy file may BE the scene, so both are handled.
 */
function readSceneIdentity(file) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { id: path.basename(file).replace(/\.json(\..*)?$/, ''), name: '', unreadable: true };
  }
  const scene =
    parsed && typeof parsed === 'object' && parsed.scene && typeof parsed.scene === 'object'
      ? parsed.scene
      : parsed;
  const id =
    (typeof scene?.id === 'string' && scene.id) ||
    path.basename(file).replace(/\.json(\..*)?$/, '');
  const name = typeof scene?.name === 'string' ? scene.name : '';
  return { id, name, unreadable: false };
}

/**
 * Every file in the store that could be a scene.
 *
 * `*.json` is a scene; `*.json.<something>.tmp` is the residue of an atomic
 * write (the store writes a temp file and renames it), so it is reported
 * under the id of the scene it belongs to.
 */
function listStoreFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith('.json') || /\.json\..*\.tmp$/.test(name))
    .sort();
}

/* ── main ────────────────────────────────────────────────────────────────── */

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      [
        'Usage: node scripts/cleanup-test-scenes.cjs [--apply] [--dir <path>]',
        '',
        '  --dry-run   print what WOULD be deleted (the default)',
        '  --apply     delete the test scenes',
        '  --dir PATH  the scene store to clean (default: the engine default)',
      ].join('\n')
    );
    return 0;
  }

  const dir = path.resolve(options.dir ?? defaultStorageDir());
  const mode = options.apply ? 'APPLY' : 'DRY RUN';

  console.log('================================================================');
  console.log('=== MOTIONFORGE — TEST SCENE CLEANUP ===');
  console.log('================================================================');
  console.log(`mode:   ${mode}`);
  console.log(`target: ${dir}`);

  if (!fs.existsSync(dir)) {
    console.log('\nThe scene store does not exist — nothing to clean.');
    console.log('\nSUMMARY: 0 deleted, 0 kept.');
    return 0;
  }

  const files = listStoreFiles(dir);
  const victims = [];
  const keepers = [];

  for (const file of files) {
    const identity = readSceneIdentity(path.join(dir, file));
    const verdict = classifyScene(identity);
    const record = { file, id: identity.id, name: identity.name, reason: verdict.reason };
    if (verdict.isTest) victims.push(record);
    else keepers.push(record);
  }

  console.log(`\n${files.length} file(s) in the store — ${victims.length} test artifact(s):`);
  for (const victim of victims) {
    console.log(`  DEL  ${victim.file}`);
    console.log(`       id="${victim.id}" name="${victim.name}" — ${victim.reason}`);
  }
  if (victims.length === 0) console.log('  (none)');

  console.log(`\n${keepers.length} composition(s) kept:`);
  for (const keeper of keepers) {
    console.log(`  KEEP ${keeper.file}  id="${keeper.id}" name="${keeper.name}"`);
  }

  let deleted = 0;
  if (options.apply) {
    for (const victim of victims) {
      const target = path.join(dir, victim.file);
      try {
        fs.unlinkSync(target);
        deleted++;
        console.log(`  removed ${victim.file}`);
      } catch (err) {
        console.error(`  FAILED ${victim.file}: ${err && err.message ? err.message : err}`);
      }
    }
  } else {
    console.log('\nDry run — nothing was deleted. Re-run with --apply to remove them.');
  }

  console.log('\n================================================================');
  console.log(
    `=== SUMMARY: ${deleted} deleted, ${keepers.length} kept, ${victims.length - deleted} not deleted ===`
  );
  console.log('================================================================');
  return 0;
}

try {
  process.exitCode = main();
} catch (err) {
  console.error('[cleanup-test-scenes] FAILED:', err && err.message ? err.message : err);
  process.exitCode = 1;
}
