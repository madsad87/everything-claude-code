#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const REQUIRED_ENTRIES = Object.freeze([
  { relativePath: '.codex-plugin/plugin.json', type: 'file' },
  { relativePath: '.mcp.json', type: 'file' },
  { relativePath: 'AGENTS.md', type: 'file' },
  { relativePath: '.codex/AGENTS.md', type: 'file' },
  { relativePath: '.codex/config.toml', type: 'file' },
  { relativePath: '.codex/agents', type: 'directory' },
  { relativePath: 'skills', type: 'directory' },
]);

const DEFAULT_OUT_DIR_SEGMENTS = ['dist', 'ecc-codex-bundle'];

function resolveRepoRoot() {
  return path.resolve(__dirname, '..', '..');
}

function parseArgs(argv) {
  const options = {
    outDir: null,
    clean: false,
    json: false,
    help: false,
  };

  const args = argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--out') {
      const outArg = args[index + 1];
      if (!outArg) {
        throw new Error('--out requires a path argument');
      }
      options.outDir = outArg;
      index += 1;
    } else if (arg === '--clean') {
      options.clean = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function getHelpText() {
  return `\nBuild a portable Codex plugin bundle for ECC\n\nUsage:\n  node scripts/codex/export-portable-bundle.js [--out <path>] [--clean] [--json]\n\nOptions:\n  --out <path>   Output directory (default: dist/ecc-codex-bundle)\n  --clean        Remove existing output directory before export\n  --json         Emit machine-readable JSON summary\n  --help, -h     Show this help text\n`;
}

function ensureRequiredSources(repoRoot) {
  const issues = [];

  for (const entry of REQUIRED_ENTRIES) {
    const absolutePath = path.join(repoRoot, entry.relativePath);
    if (!fs.existsSync(absolutePath)) {
      issues.push(`Missing required ${entry.type}: ${entry.relativePath}`);
      continue;
    }

    const stat = fs.statSync(absolutePath);
    if (entry.type === 'file' && !stat.isFile()) {
      issues.push(`Expected file but found non-file: ${entry.relativePath}`);
    }
    if (entry.type === 'directory' && !stat.isDirectory()) {
      issues.push(`Expected directory but found non-directory: ${entry.relativePath}`);
    }
  }

  if (issues.length > 0) {
    throw new Error(issues.join('; '));
  }
}

function removeDirectoryIfRequested(outDir, clean) {
  if (!clean || !fs.existsSync(outDir)) {
    return;
  }
  fs.rmSync(outDir, { recursive: true, force: true });
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyEntry(repoRoot, outDir, relativePath) {
  const sourcePath = path.join(repoRoot, relativePath);
  const destinationPath = path.join(outDir, relativePath);
  const sourceStat = fs.statSync(sourcePath);

  if (sourceStat.isDirectory()) {
    ensureDirectory(path.dirname(destinationPath));
    fs.cpSync(sourcePath, destinationPath, { recursive: true });
  } else {
    ensureDirectory(path.dirname(destinationPath));
    fs.copyFileSync(sourcePath, destinationPath);
  }
}

function walkFiles(dirPath, acc = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absolutePath, acc);
    } else if (entry.isFile()) {
      acc.push(absolutePath);
    }
  }
  return acc;
}

function sha256ForFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function getTopLevelChecksums(outDir) {
  const targets = [
    '.codex-plugin/plugin.json',
    '.mcp.json',
    'AGENTS.md',
    '.codex/AGENTS.md',
    '.codex/config.toml',
    'VERSION',
  ];

  const checksums = {};
  for (const relativePath of targets) {
    const absolutePath = path.join(outDir, relativePath);
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      checksums[relativePath] = sha256ForFile(absolutePath);
    }
  }
  return checksums;
}

function detectSourceCommit(repoRoot) {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

function countSkillDirectories(skillsRoot) {
  if (!fs.existsSync(skillsRoot)) {
    return 0;
  }

  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .length;
}

function readPackageVersion(repoRoot) {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.version || null;
}

function writeBundleManifest(outDir, metadata) {
  const manifestPath = path.join(outDir, 'BUNDLE-MANIFEST.json');
  fs.writeFileSync(manifestPath, JSON.stringify(metadata, null, 2) + '\n', 'utf8');
  return manifestPath;
}

function buildSummary({ repoRoot, outDir }) {
  const allFiles = walkFiles(outDir);
  const relativeFiles = allFiles
    .map(filePath => path.relative(outDir, filePath).split(path.sep).join('/'))
    .sort();

  const summary = {
    bundleVersion: readPackageVersion(repoRoot),
    sourceCommit: detectSourceCommit(repoRoot),
    generatedAt: new Date().toISOString(),
    outDir,
    fileCount: relativeFiles.length,
    skillsCount: countSkillDirectories(path.join(outDir, 'skills')),
    checksums: getTopLevelChecksums(outDir),
    files: relativeFiles,
  };

  const manifestPath = writeBundleManifest(outDir, summary);
  return {
    ...summary,
    manifestPath,
  };
}

function resolveOutDir(repoRoot, requestedOutDir) {
  if (!requestedOutDir) {
    return path.join(repoRoot, ...DEFAULT_OUT_DIR_SEGMENTS);
  }

  if (path.isAbsolute(requestedOutDir)) {
    return requestedOutDir;
  }

  return path.resolve(process.cwd(), requestedOutDir);
}

function runBundle(options = {}) {
  const repoRoot = options.repoRoot || resolveRepoRoot();
  const outDir = resolveOutDir(repoRoot, options.outDir);
  const clean = Boolean(options.clean);

  ensureRequiredSources(repoRoot);
  removeDirectoryIfRequested(outDir, clean);
  ensureDirectory(outDir);

  copyEntry(repoRoot, outDir, '.codex-plugin');
  copyEntry(repoRoot, outDir, '.mcp.json');
  copyEntry(repoRoot, outDir, 'AGENTS.md');
  copyEntry(repoRoot, outDir, '.codex');
  copyEntry(repoRoot, outDir, 'skills');

  const versionPath = path.join(repoRoot, 'VERSION');
  if (fs.existsSync(versionPath) && fs.statSync(versionPath).isFile()) {
    copyEntry(repoRoot, outDir, 'VERSION');
  }

  return buildSummary({ repoRoot, outDir });
}

function printSummary(summary, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write('\nECC Codex portable bundle exported\n');
  process.stdout.write(`- Output: ${summary.outDir}\n`);
  process.stdout.write(`- Files: ${summary.fileCount}\n`);
  process.stdout.write(`- Skills: ${summary.skillsCount}\n`);
  process.stdout.write(`- Commit: ${summary.sourceCommit || 'unknown'}\n`);
  process.stdout.write(`- Manifest: ${summary.manifestPath}\n`);
}

function main() {
  try {
    const options = parseArgs(process.argv);

    if (options.help) {
      process.stdout.write(getHelpText());
      process.exit(0);
    }

    const summary = runBundle(options);
    printSummary(summary, options.json);
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.stderr.write(getHelpText());
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_OUT_DIR_SEGMENTS,
  REQUIRED_ENTRIES,
  ensureRequiredSources,
  parseArgs,
  resolveOutDir,
  runBundle,
};
