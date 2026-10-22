#!/usr/bin/env node
/**
 * An ISOLATED environment for the Electron verification harnesses.
 *
 * THE DEFECT THIS FIXES
 * ---------------------
 * The harnesses used to launch the real desktop app with only
 * `MOTIONFORGE_TEST_MODE=1`. The engine then resolved its DEFAULT storage
 * (`~/.motionforge/scenes`, `~/.motionforge/vault`, `~/.motionforge/renders`),
 * so every run WROTE ITS TEST SCENES INTO THE USER'S WORKSPACE. The Project
 * Bin's COMPOSITIONS list ended up littered with leftovers ("Lock Probe",
 * "Monitor Electron Smoke 1/2/3", "Pro NLE Verification Dirty", …).
 *
 * THE FIX
 * -------
 * Every harness now builds a throw-away directory tree and points the engine
 * at it through the SAME environment variables `packages/core-engine/src/config.ts`
 * reads:
 *
 *   MOTIONFORGE_DATA_DIR     → <tmp>/mf-test-<label>-<pid>-<rand>
 *   MOTIONFORGE_STORAGE_DIR  → <tmp>/mf-test-<label>-<pid>-<rand>/scenes
 *   MOTIONFORGE_VAULT_DIR    → <tmp>/mf-test-<label>-<pid>-<rand>/vault
 *   MOTIONFORGE_RENDERS_DIR  → <tmp>/mf-test-<label>-<pid>-<rand>/renders
 *   MOTIONFORGE_TEST_MODE    → 1
 *
 * The tree is removed in a `finally`, so a crash never leaks a directory and
 * the user's `~/.motionforge` is never read or written.
 *
 * Usage:
 *   const { makeTestEnv, makeTestDirs, cleanupTestDirs } = require('./lib/test-env.cjs');
 *   const dirs = makeTestDirs('pro-nle');
 *   try {
 *     await electron.launch({ args: [...], env: makeTestEnv(dirs) });
 *   } finally {
 *     cleanupTestDirs(dirs);
 *   }
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

/** The environment variables `packages/core-engine/src/config.ts` reads. */
const ENV_KEYS = {
  testMode: 'MOTIONFORGE_TEST_MODE',
  dataDir: 'MOTIONFORGE_DATA_DIR',
  storageDir: 'MOTIONFORGE_STORAGE_DIR',
  vaultDir: 'MOTIONFORGE_VAULT_DIR',
  rendersDir: 'MOTIONFORGE_RENDERS_DIR',
};

/**
 * Create a unique, isolated workspace for ONE test run.
 *
 * The layout mirrors the engine's default layout so the engine code needs no
 * test-only branch:
 *
 *   <tmp>/mf-test-<label>-<pid>-<rand>/
 *     scenes/    ← MOTIONFORGE_STORAGE_DIR  (the scene store)
 *     vault/     ← MOTIONFORGE_VAULT_DIR    (assets + the SFX bank)
 *     renders/   ← MOTIONFORGE_RENDERS_DIR  (MP4s and inspection stills)
 *
 * @param {string} [label] a short tag that makes the directory recognisable
 * @returns {{root: string, data: string, scenes: string, vault: string, renders: string}}
 */
function makeTestDirs(label = 'run') {
  const unique = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const root = path.join(os.tmpdir(), `mf-test-${label}-${unique}`);
  const dirs = {
    root,
    data: root,
    scenes: path.join(root, 'scenes'),
    vault: path.join(root, 'vault'),
    renders: path.join(root, 'renders'),
  };
  for (const dir of [dirs.root, dirs.scenes, dirs.vault, dirs.renders]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dirs;
}

/**
 * Build the environment for an Electron launch that must NOT touch the
 * developer's real workspace.
 *
 * @param {{root: string, data: string, scenes: string, vault: string, renders: string}} dirs
 * @param {Record<string, string>} [extra] additional environment overrides
 * @returns {Record<string, string>}
 */
function makeTestEnv(dirs, extra = {}) {
  if (!dirs || !dirs.root) {
    throw new Error('makeTestEnv needs the object returned by makeTestDirs()');
  }
  return {
    ...process.env,
    [ENV_KEYS.testMode]: '1',
    [ENV_KEYS.dataDir]: dirs.data,
    [ENV_KEYS.storageDir]: dirs.scenes,
    [ENV_KEYS.vaultDir]: dirs.vault,
    [ENV_KEYS.rendersDir]: dirs.renders,
    ...extra,
  };
}

/**
 * The Electron launch arguments that keep the app's OWN storage out of the
 * developer's real profile.
 *
 * THE LEAK THIS CLOSES: the engine's storage is isolated through the
 * MOTIONFORGE_* environment variables, but the Studio's renderer keeps its
 * state in `localStorage`, and Electron's `localStorage` lives in the app's
 * `userData` DIRECTORY — which is the developer's real profile. A test run
 * therefore wrote its render queue, its panel sizes and its workspace layout
 * into the developer's Electron profile.
 *
 * `--user-data-dir` moves that directory into the throw-away tree, so the
 * whole session is isolated and removed with everything else.
 *
 * @param {{root: string}} dirs
 * @returns {string[]}
 */
function makeTestElectronArgs(dirs) {
  if (!dirs || !dirs.root) return [];
  return [`--user-data-dir=${path.join(dirs.root, 'electron-profile')}`];
}

/**
 * Remove the isolated tree. Safe to call twice and safe to call when the
 * directory was never created.
 *
 * @param {{root: string}} dirs
 */
function cleanupTestDirs(dirs) {
  if (!dirs || !dirs.root) return;
  try {
    fs.rmSync(dirs.root, { recursive: true, force: true });
  } catch (err) {
    console.error(`[test-env] could not remove ${dirs.root}:`, err && err.message ? err.message : err);
  }
}

/**
 * A one-line description of the isolated workspace, for the harness header.
 *
 * @param {{root: string, scenes: string, vault: string, renders: string}} dirs
 * @returns {string}
 */
function describeTestDirs(dirs) {
  if (!dirs || !dirs.root) return '(no isolated workspace)';
  return `${dirs.root}  (scenes: ${dirs.scenes} | vault: ${dirs.vault} | renders: ${dirs.renders})`;
}

module.exports = {
  ENV_KEYS,
  makeTestDirs,
  makeTestEnv,
  makeTestElectronArgs,
  cleanupTestDirs,
  describeTestDirs,
};
