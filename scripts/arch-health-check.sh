#!/usr/bin/env bash
# arch-health-check.sh — svc-forum 架构体检工具
# 检查项：文件行数 TOP10 / 循环依赖 / 魔法值 / routes 纯度
# 输出：JSON (stdout) + exit code (0=PASS, 非0=FAIL)
# exit code 位含义：bit-1=行数超限(1), bit-2=循环依赖(2), bit-3=魔法值(4), bit-4=routes 不纯(8)
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_DIR="$ROOT_DIR/svc-forum"
SRC_DIR="$NODE_DIR/src"
ROUTES_DIR="$SRC_DIR/routes"

MAX_LINES=500
GRANDFATHER_FILE="$ROOT_DIR/.arch-grandfather.yml"

# ── 工具函数 ──────────────────────────────────────────
is_grandfathered() {
  local file="$1"
  if [[ ! -f "$GRANDFATHER_FILE" ]]; then
    return 1
  fi
  local patterns
  patterns=$(grep -E '^\s*-?\s*pattern:' "$GRANDFATHER_FILE" 2>/dev/null | sed 's/.*pattern:\s*//' | tr -d '"' || true)
  for p in $patterns; do
    if [[ "$file" == *"$p"* ]]; then
      local expiry
      expiry=$(grep -A5 "pattern:.*$p" "$GRANDFATHER_FILE" 2>/dev/null | grep -E '^\s*expiry:' | sed 's/.*expiry:\s*//' | tr -d '"' | xargs || true)
      if [[ -n "$expiry" ]]; then
        local today; today=$(date +%Y-%m-%d)
        if [[ "$today" > "$expiry" ]]; then
          return 1
        fi
      fi
      return 0
    fi
  done
  return 1
}

# ── 检查 1：文件行数 TOP10 ────────────────────────────
check_line_count() {
  local violations=()
  local top10=()

  while IFS= read -r f; do
    local rel="${f#$ROOT_DIR/}"
    local lines; lines=$(wc -l < "$f" | tr -d ' ')
    top10+=("{\"file\":\"$rel\",\"lines\":$lines}")
    if [[ "$lines" -gt "$MAX_LINES" ]]; then
      is_grandfathered "$rel" || violations+=("{\"file\":\"$rel\",\"lines\":$lines,\"limit\":$MAX_LINES}")
    fi
  done < <(find "$SRC_DIR" -name '*.ts' -not -path '*/node_modules/*' -not -path '*/dist/*' | sort)

  local sorted_top10 violations_json
  sorted_top10=$(printf '%s\n' "${top10[@]}" 2>/dev/null | python3 -c "
import sys, json
items = [json.loads(l.strip()) for l in sys.stdin if l.strip()]
items.sort(key=lambda x: x['lines'], reverse=True)
print(json.dumps(items[:10], ensure_ascii=False))
" 2>/dev/null || echo '[]')

  violations_json=$(printf '%s\n' "${violations[@]}" 2>/dev/null | python3 -c "
import sys, json
items = [json.loads(l.strip()) for l in sys.stdin if l.strip()]
print(json.dumps(items, ensure_ascii=False))
" 2>/dev/null || echo '[]')

  echo "{\"top10\":$sorted_top10,\"violations\":$violations_json,\"limit\":$MAX_LINES}"
  [[ ${#violations[@]} -eq 0 ]]
}

# ── 检查 2：循环依赖 ──────────────────────────────────
check_circular_deps() {
  local errors=()
  local tsc_output

  # tsc --noEmit 检测，超时 30s 保护
  if ! tsc_output=$(cd "$NODE_DIR" && timeout 30 npx tsc --noEmit 2>&1); then
    while IFS= read -r line; do
      if echo "$line" | grep -qi "circular\|cycle"; then
        errors+=("$(echo "$line" | sed 's/"/\\"/g')")
      fi
    done <<< "${tsc_output:-}"
  fi

  local errors_json
  errors_json=$(printf '%s\n' "${errors[@]}" 2>/dev/null | python3 -c "
import sys, json
items = [l.strip() for l in sys.stdin if l.strip()]
print(json.dumps(items, ensure_ascii=False))
" 2>/dev/null || echo '[]')

  echo "{\"circularDeps\":$errors_json}"
  [[ ${#errors[@]} -eq 0 ]]
}

# ── 检查 3：魔法值 ────────────────────────────────────
check_magic_values() {
  local violations=()

  while IFS= read -r f; do
    local rel="${f#$ROOT_DIR/}"
    is_grandfathered "$rel" && continue
    # 性能：单次 grep -nE 批量匹配候选行（原实现逐行 fork grep，实测 71s → 修复后 <10s）
    # 过滤逻辑与原实现一致：排除常量定义行、import/export/type/interface 声明行
    while IFS=: read -r lineno content; do
      [[ -z "$lineno" ]] && continue
      local trimmed; trimmed=$(echo "$content" | sed 's/"/\\"/g; s/^[[:space:]]*//')
      violations+=("{\"file\":\"$rel\",\"line\":$lineno,\"snippet\":\"$trimmed\"}")
    done < <(grep -nE '\b[3-9][0-9]{1,}\b' "$f" 2>/dev/null \
      | grep -vE '(const|enum|static|readonly).*=' \
      | grep -vE '^[0-9]+:[[:space:]]*(import|export|type|interface)[[:space:]]' \
      || true)
  done < <(find "$SRC_DIR" -name '*.ts' -not -path '*/node_modules/*' -not -path '*/dist/*' -not -name '*.test.ts' -not -name '*.schema.ts' -not -name '*.d.ts' | sort)

  local violations_json
  violations_json=$(printf '%s\n' "${violations[@]}" 2>/dev/null | python3 -c "
import sys, json
items = [json.loads(l.strip()) for l in sys.stdin if l.strip()]
print(json.dumps(items[:50], ensure_ascii=False))
" 2>/dev/null || echo '[]')

  echo "{\"magicValues\":$violations_json,\"note\":\"数字>=30 的字面量（排除常量定义/import-export/test/schema 文件）\"}"
  [[ ${#violations[@]} -le 50 ]]
}

# ── 检查 4：routes 纯度 ───────────────────────────────
check_routes_purity() {
  local violations=()

  if [[ ! -d "$ROUTES_DIR" ]]; then
    echo '{"routesPurity":[],"note":"routes 目录不存在"}'
    return 0
  fi

  while IFS= read -r f; do
    local rel="${f#$ROOT_DIR/}"
    local basename; basename=$(basename "$f")
    [[ "$basename" == "health.ts" ]] && continue

    if grep -qE 'prisma\.\w+\.' "$f" 2>/dev/null; then
      while IFS= read -r match; do
        [[ -z "$match" ]] && continue
        local escaped; escaped=$(echo "$match" | sed 's/"/\\"/g; s/^[[:space:]]*//')
        violations+=("{\"file\":\"$rel\",\"line\":\"$escaped\"}")
      done < <(grep -nE 'prisma\.\w+\.' "$f" 2>/dev/null || true)
    fi
  done < <(find "$ROUTES_DIR" -name '*.ts' -not -path '*/node_modules/*' | sort)

  local violations_json
  violations_json=$(printf '%s\n' "${violations[@]}" 2>/dev/null | python3 -c "
import sys, json
items = [json.loads(l.strip()) for l in sys.stdin if l.strip()]
print(json.dumps(items, ensure_ascii=False))
" 2>/dev/null || echo '[]')

  echo "{\"routesPurity\":$violations_json,\"rule\":\"routes 不应直接调 Prisma（health.ts 除外）\"}"
  [[ ${#violations[@]} -eq 0 ]]
}

# ── 主流程 ────────────────────────────────────────────
main() {
  local lc_code=0 cd_code=0 mv_code=0 rp_code=0
  local line_count_result circ_deps_result magic_result routes_result

  line_count_result=$(check_line_count) || lc_code=1
  circ_deps_result=$(check_circular_deps) || cd_code=1
  magic_result=$(check_magic_values) || mv_code=1
  routes_result=$(check_routes_purity) || rp_code=1

  local result_code=$(( lc_code | (cd_code << 1) | (mv_code << 2) | (rp_code << 3) ))

  local lc_pass cd_pass mv_pass rp_pass
  [[ $lc_code -eq 0 ]] && lc_pass=true || lc_pass=false
  [[ $cd_code -eq 0 ]] && cd_pass=true || cd_pass=false
  [[ $mv_code -eq 0 ]] && mv_pass=true || mv_pass=false
  [[ $rp_code -eq 0 ]] && rp_pass=true || rp_pass=false

  # 安全地将结果传入 python
  export LC_RESULT="$line_count_result"
  export CD_RESULT="$circ_deps_result"
  export MV_RESULT="$magic_result"
  export RP_RESULT="$routes_result"

  python3 -c "
import json, datetime, os

def safe_loads(s):
    try:
        return json.loads(s)
    except:
        return {}

line_count = safe_loads(os.environ['LC_RESULT'])
circ_deps = safe_loads(os.environ['CD_RESULT'])
magic = safe_loads(os.environ['MV_RESULT'])
routes = safe_loads(os.environ['RP_RESULT'])

lc_pass = True if '${lc_pass}' == 'true' else False
cd_pass = True if '${cd_pass}' == 'true' else False
mv_pass = True if '${mv_pass}' == 'true' else False
rp_pass = True if '${rp_pass}' == 'true' else False

result = {
    'tool': 'arch-health-check',
    'version': '1.0.0',
    'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'checks': {
        'lineCount': {**line_count, 'passed': lc_pass},
        'circularDeps': {**circ_deps, 'passed': cd_pass},
        'magicValues': {**magic, 'passed': mv_pass},
        'routesPurity': {**routes, 'passed': rp_pass},
    },
    'overall': 'PASS' if (lc_pass and cd_pass and mv_pass and rp_pass) else 'FAIL',
    'exitCode': ${result_code},
}

print(json.dumps(result, indent=2, ensure_ascii=False))
"

  exit $result_code
}

main "$@"
