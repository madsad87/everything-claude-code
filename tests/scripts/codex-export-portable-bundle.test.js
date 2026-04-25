/**
 * Tests for scripts/codex/export-portable-bundle.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseArgs,
  REQUIRED_ENTRIES,
  runBundle,
} = require('../../scripts/codex/export-portable-bundle');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function createFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-bundle-fixture-'));

  fs.mkdirSync(path.join(root, '.codex-plugin'), { recursive: true });
  writeJson(path.join(root, '.codex-plugin', 'plugin.json'), {
    name: 'ecc',
    skills: './skills/',
    mcpServers: './.mcp.json',
  });

  writeJson(path.join(root, '.mcp.json'), {
    mcpServers: {
      exa: { type: 'http', url: 'https://mcp.exa.ai/mcp' },
    },
  });

  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Fixture AGENTS\n', 'utf8');
  fs.mkdirSync(path.join(root, '.codex', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.codex', 'AGENTS.md'), '# Fixture Codex AGENTS\n', 'utf8');
  fs.writeFileSync(path.join(root, '.codex', 'config.toml'), 'approval_policy = "on-request"\n', 'utf8');
  fs.writeFileSync(path.join(root, '.codex', 'agents', 'explorer.toml'), 'approval_policy = "on-request"\n', 'utf8');

  fs.mkdirSync(path.join(root, 'skills', 'tdd-workflow'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'tdd-workflow', 'SKILL.md'), '# TDD\n', 'utf8');

  fs.writeFileSync(path.join(root, 'VERSION'), '1.0.0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }, null, 2), 'utf8');

  return root;
}

function runTests() {
  console.log('\n=== Testing codex export portable bundle ===\n');

  let passed = 0;
  let failed = 0;

  if (test('parseArgs handles expected flags', () => {
    const parsed = parseArgs(['node', 'script.js', '--out', 'tmp/out', '--clean', '--json']);
    assert.strictEqual(parsed.outDir, 'tmp/out');
    assert.strictEqual(parsed.clean, true);
    assert.strictEqual(parsed.json, true);
    assert.strictEqual(parsed.help, false);
  })) passed++; else failed++;

  if (test('required sources include codex plugin manifest and skills directory', () => {
    const requiredPaths = REQUIRED_ENTRIES.map(entry => entry.relativePath);
    assert.ok(requiredPaths.includes('.codex-plugin/plugin.json'));
    assert.ok(requiredPaths.includes('skills'));
  })) passed++; else failed++;

  if (test('runBundle exports expected files and writes bundle manifest', () => {
    const fixtureRoot = createFixtureRepo();
    const outDir = path.join(fixtureRoot, 'dist', 'bundle');

    const summary = runBundle({
      repoRoot: fixtureRoot,
      outDir,
      clean: true,
    });

    assert.ok(fs.existsSync(path.join(outDir, '.codex-plugin', 'plugin.json')));
    assert.ok(fs.existsSync(path.join(outDir, '.mcp.json')));
    assert.ok(fs.existsSync(path.join(outDir, 'AGENTS.md')));
    assert.ok(fs.existsSync(path.join(outDir, '.codex', 'AGENTS.md')));
    assert.ok(fs.existsSync(path.join(outDir, '.codex', 'agents', 'explorer.toml')));
    assert.ok(fs.existsSync(path.join(outDir, 'skills', 'tdd-workflow', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(outDir, 'BUNDLE-MANIFEST.json')));

    assert.strictEqual(summary.bundleVersion, '9.9.9');
    assert.strictEqual(summary.skillsCount, 1);
    assert.ok(summary.fileCount >= 7);
    assert.ok(summary.checksums['.codex-plugin/plugin.json']);
    assert.ok(summary.checksums['.mcp.json']);
  })) passed++; else failed++;

  if (test('clean mode removes stale files in output directory', () => {
    const fixtureRoot = createFixtureRepo();
    const outDir = path.join(fixtureRoot, 'dist', 'bundle');

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'stale.txt'), 'old', 'utf8');

    runBundle({
      repoRoot: fixtureRoot,
      outDir,
      clean: true,
    });

    assert.ok(!fs.existsSync(path.join(outDir, 'stale.txt')));
  })) passed++; else failed++;

  if (test('runBundle throws when required inputs are missing', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-bundle-empty-'));
    const outDir = path.join(fixtureRoot, 'dist', 'bundle');

    assert.throws(
      () => runBundle({ repoRoot: fixtureRoot, outDir, clean: true }),
      /Missing required/,
    );
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
