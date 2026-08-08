#!/usr/bin/env node

/**
 * Build the static Tauri updater manifest from the signed bundles produced by
 * the release matrix. Keeping this out of workflow shell makes the exact asset
 * selection testable before a tag spends three runners' worth of build time.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function exactlyOne(files, predicate, label) {
  const matches = files.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${label}; found ${matches.length}: ${matches.join(', ') || '(none)'}`);
  }
  return matches[0];
}

function signatureFor(directory, asset) {
  const signaturePath = join(directory, `${asset}.sig`);
  let signature;
  try {
    signature = readFileSync(signaturePath, 'utf8').trim();
  } catch {
    throw new Error(`missing updater signature: ${basename(signaturePath)}`);
  }
  if (signature === '') throw new Error(`empty updater signature: ${basename(signaturePath)}`);
  return signature;
}

function releaseUrl(repository, tag, asset) {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
}

export function writeUpdaterManifest({
  directory,
  tag,
  repository,
  notesFile,
  output = join(directory, 'latest.json'),
  pubDate = new Date().toISOString(),
}) {
  if (!/^v[^/\s]+$/.test(tag)) throw new Error(`invalid release tag: ${tag}`);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`invalid GitHub repository: ${repository}`);
  }
  if (!Number.isFinite(new Date(pubDate).getTime())) throw new Error(`invalid publication date: ${pubDate}`);

  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  // The normal NSIS setup is the Windows updater. The 200+ MB offline setup
  // remains a manual download and must never be selected just because it also
  // ends in `.exe`.
  const windows = exactlyOne(
    files,
    (name) => name.endsWith('-setup.exe') && !name.endsWith('-setup-offline.exe'),
    'Windows NSIS updater',
  );
  const linux = exactlyOne(files, (name) => name.endsWith('.AppImage'), 'Linux AppImage updater');
  const mac = exactlyOne(files, (name) => name.endsWith('.app.tar.gz'), 'macOS app updater archive');

  const entry = (asset) => ({
    signature: signatureFor(directory, asset),
    url: releaseUrl(repository, tag, asset),
  });
  const macEntry = entry(mac);
  const manifest = {
    version: tag.slice(1),
    notes: readFileSync(notesFile, 'utf8').trim(),
    pub_date: new Date(pubDate).toISOString(),
    platforms: {
      'darwin-aarch64': macEntry,
      'darwin-x86_64': macEntry,
      'linux-x86_64': entry(linux),
      'windows-x86_64': entry(windows),
    },
  };

  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) throw new Error(`unexpected argument: ${current}`);
    const equals = current.indexOf('=');
    if (equals !== -1) {
      args.set(current.slice(2, equals), current.slice(equals + 1));
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${current}`);
    args.set(current.slice(2), value);
    i += 1;
  }
  const required = (name) => {
    const value = args.get(name);
    if (value === undefined || value === '') throw new Error(`missing --${name}`);
    return value;
  };
  return {
    directory: resolve(required('dir')),
    tag: required('tag'),
    repository: required('repository'),
    notesFile: resolve(required('notes')),
    output: args.has('output') ? resolve(required('output')) : undefined,
    pubDate: args.get('date'),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = writeUpdaterManifest(options);
  console.log(`wrote ${options.output ?? join(options.directory, 'latest.json')} for ${manifest.version}`);
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
