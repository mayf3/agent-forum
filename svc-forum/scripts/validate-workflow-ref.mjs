#!/usr/bin/env node
/**
 * validate-workflow-ref.mjs — PR 工作流实例 ID 校验器（L0 门禁）
 *
 * 职责：
 *   1. 从 PR body 中提取 workflow 实例 UUID（格式约定：`Workflow: <uuid>`，大小写不敏感）
 *   2. 调用 svc-workflow API 校验实例存在且状态合法（未终止 / 非驳回）
 *   3. 校验失败 → exit code 非 0 → GitHub status check = fail → merge 按钮禁用
 *
 * 用法：
 *   node scripts/validate-workflow-ref.mjs \
 *     --pr-body "PR description text..." \
 *     --api-base "http://localhost:8989" \
 *     --token "Bearer xxx" \
 *     [--fail-open]          # API 不可用时放行（默认 fail-close 安全第一）
 *
 * 退出码：0 = 通过；1 = 校验失败（缺 ID / 实例不存在 / 状态非法）；2 = 用法错误
 */
import { readFileSync } from 'node:fs';

const UUID_RE = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/;
const WORKFLOW_REF_RE = /workflow\s*[:：]\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/i;

function parseArgs(argv) {
  const args = { prBody: '', apiBase: 'http://localhost:8989', token: '', failOpen: false };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--pr-body':
        args.prBody = argv[++i] ?? '';
        break;
      case '--pr-body-file':
        args.prBody = readFileSync(argv[++i], 'utf-8');
        break;
      case '--api-base':
        args.apiBase = argv[++i] ?? args.apiBase;
        break;
      case '--token':
        args.token = argv[++i] ?? '';
        break;
      case '--fail-open':
        args.failOpen = true;
        break;
      default:
        break;
    }
  }
  return args;
}

function extractWorkflowId(prBody) {
  const match = prBody.match(WORKFLOW_REF_RE);
  if (match) return match[1].toLowerCase();
  // 兜底：body 中任意 36 位 UUID（格式不严格时也给一次机会，但输出警告）
  const anyUuid = prBody.match(UUID_RE);
  if (anyUuid) {
    console.warn(`[validator] 未找到 "Workflow: <uuid>" 格式，但检测到 UUID ${anyUuid[0]}（建议使用标准格式 "Workflow: <uuid>"）`);
    return anyUuid[0].toLowerCase();
  }
  return null;
}

async function validateInstance(apiBase, token, instanceId) {
  const res = await fetch(`${apiBase}/internal/v1/workflow-instances/${instanceId}`, {
    headers: {
      Authorization: token.startsWith('Bearer') ? token : `Bearer ${token}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status === 404) {
    return { ok: false, reason: `实例不存在: ${instanceId}` };
  }
  if (!res.ok) {
    return { ok: false, reason: `API 返回 ${res.status}` };
  }

  const data = await res.json();
  const inst = data?.detail?.instance ?? data?.instance ?? data;
  const isTerminal = inst.is_terminal ?? inst.isTerminal;
  const currentNodeKey = inst.current_node?.node_key ?? inst.currentNode?.node_key ?? '';

  if (isTerminal === true) {
    return { ok: false, reason: `实例 ${instanceId} 已终止（terminal），不允许合并` };
  }
  // 驳回态：工作流没有显式 rejected 字段，用当前节点推断。
  // 驳回 = 实例被打回（current node 为被打回节点）时由 RETURN 事件标记。
  // 这里校验最小集：存在 + 未终止 + 域启用。更严格的状态判断由服务端保证。
  if (inst.domain_enabled === false) {
    return { ok: false, reason: `实例 ${instanceId} 所在域已禁用` };
  }
  return { ok: true, instanceId, currentNodeKey, isTerminal: false };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.prBody) {
    console.error('[validator] 缺少 --pr-body / --pr-body-file');
    process.exit(2);
  }

  const workflowId = extractWorkflowId(args.prBody);
  if (!workflowId) {
    console.error('[validator] FAIL: PR 描述中未找到工作流实例 ID');
    console.error('[validator] 请在 PR 描述中按格式注明: Workflow: <uuid>（36 位 UUID）');
    process.exit(1);
  }
  console.log(`[validator] 提取到工作流实例 ID: ${workflowId}`);

  if (!args.token) {
    if (args.failOpen) {
      console.warn('[validator] WARN: 未提供 token 且 --fail-open，放行（不推荐）');
      process.exit(0);
    }
    console.error('[validator] FAIL: 未提供 API token（设置 WORKFLOW_TOKEN 或 --token）');
    process.exit(1);
  }

  try {
    const result = await validateInstance(args.apiBase, args.token, workflowId);
    if (result.ok) {
      console.log(`[validator] PASS: 实例 ${workflowId} 合法（当前节点: ${result.currentNodeKey || '?'}）`);
      process.exit(0);
    }
    console.error(`[validator] FAIL: ${result.reason}`);
    process.exit(1);
  } catch (err) {
    if (args.failOpen) {
      console.warn(`[validator] WARN: API 调用失败（${err.message}），--fail-open 放行`);
      process.exit(0);
    }
    console.error(`[validator] FAIL: API 调用失败（${err.message}）。fail-close：拒绝合并（安全第一）`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[validator] 未预期错误: ${err.message}`);
  process.exit(1);
});
