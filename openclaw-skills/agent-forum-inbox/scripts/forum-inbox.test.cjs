#!/usr/bin/env node

/**
 * Tests for agent-forum-inbox skill CLI.
 *
 * Static analysis + CLI parsing tests (offline, no services needed).
 * Integration tests (require AGENT_FORUM_PRE_SIGNED_TOKEN etc.).
 *
 * Usage:
 *   AGENT_FORUM_PRE_SIGNED_TOKEN=test node --test forum-inbox.test.cjs
 *   AGENT_FORUM_PRE_SIGNED_TOKEN=<real> node --test forum-inbox.test.cjs
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const SCRIPT = path.join(__dirname, 'forum-inbox.mjs');
const SOURCE = fs.readFileSync(SCRIPT, 'utf-8');

function run(args, stdin) {
  return spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf-8', timeout: 5000, input: stdin,
  });
}

// ── Static code analysis ──

describe('static analysis', () => {
  it('no feishu integration', () => {
    assert.ok(!SOURCE.includes('feishu'));
    assert.ok(!SOURCE.includes('lark'));
    assert.ok(!SOURCE.includes('飞书'));
  });

  it('no eval usage', () => {
    assert.ok(!SOURCE.includes('eval('));
    assert.ok(!SOURCE.includes('eval '));
  });

  it('no shell command injection', () => {
    assert.ok(!SOURCE.includes('exec('));
    assert.ok(!SOURCE.includes('execSync'));
    assert.ok(!SOURCE.includes("shell: true"));
    assert.ok(!SOURCE.includes("shell:true"));
  });

  it('request timeout configured', () => {
    assert.ok(SOURCE.includes('AbortController'));
    assert.ok(SOURCE.includes('REQUEST_TIMEOUT'));
  });

  it('response size limit', () => {
    assert.ok(SOURCE.includes('500_000'));
  });

  it('safePathSegment prevents injection', () => {
    assert.ok(SOURCE.includes('safePathSegment'));
  });

  it('env var config', () => {
    assert.ok(SOURCE.includes('AGENT_FORUM_BASE_URL'));
    assert.ok(SOURCE.includes('AUTH_SERVICE_URL'));
    assert.ok(SOURCE.includes('AGENT_FORUM_PRE_SIGNED_TOKEN'));
  });

  it('no decision/resolve/waiver endpoints in script', () => {
    const matches = SOURCE.match(/\/resolve|\/waive|\/decision/g);
    assert.equal(matches, null);
  });

  it('only allowed kinds for complete', () => {
    const m = SOURCE.match(/const allowed = \[(.+?)\]/);
    if (m) {
      assert.ok(!m[1].includes('decision'));
      assert.ok(!m[1].includes('system'));
    }
  });

  it('no stack trace leakage', () => {
    assert.ok(SOURCE.includes('err.message'));
    assert.ok(!SOURCE.includes('err.stack'));
  });
});

// ── CLI argument parsing ──

describe('cli parsing', () => {
  it('no args shows usage', () => {
    const r = run([]);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('Usage'));
  });

  it('unknown command shows error', () => {
    const r = run(['bogus']);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('Unknown'));
  });

  it('complete without stdin fails', () => {
    const r = run(['complete', 'x']);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('stdin'));
  });

  it('complete empty content fails', () => {
    const r = run(['complete', 'x'], JSON.stringify({ content: '' }));
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('content'));
  });

  it('fail without stdin fails', () => {
    const r = run(['fail', 'x']);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('stdin'));
  });

  it('fail empty error fails', () => {
    const r = run(['fail', 'x'], JSON.stringify({ error: '' }));
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('error'));
  });
});

// ── Integration (conditional) ──

const hasIntegration = !!(process.env.AGENT_FORUM_BASE_URL &&
  process.env.AUTH_SERVICE_URL &&
  process.env.AGENT_FORUM_PRE_SIGNED_TOKEN);

describe('integration', { skip: !hasIntegration }, () => {
  it('login returns accessToken with agentId', () => {
    const r = run(['login']);
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout);
    assert.ok(o.accessToken);
    assert.ok(o.user.agentId);
  });

  it('inbox returns task array', () => {
    const r = run(['inbox']);
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout);
    assert.ok(Array.isArray(o.tasks));
    assert.ok(typeof o.count === 'number');
  });
});
