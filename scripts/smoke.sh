#!/bin/zsh
# AI Command Center — smoke tests. Read-only + one temp workflow create/delete.
# Verifies every API surface responds correctly. Exit 0 = all pass.
BASE=${CC_URL:-http://localhost:1717}
pass=0; fail=0
ck() { # name  expected_http  url  [method]  [body]
  local name=$1 exp=$2 url=$3 method=${4:-GET} body=$5
  local code
  if [ -n "$body" ]; then code=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" -H 'Content-Type: application/json' -d "$body" "$BASE$url")
  else code=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "$BASE$url"); fi
  if [ "$code" = "$exp" ]; then echo "  PASS  $name ($code)"; pass=$((pass+1))
  else echo "  FAIL  $name (got $code, want $exp)"; fail=$((fail+1)); fi
}
jck() { # name  url  jq-ish python expr must print non-empty
  local name=$1 url=$2 expr=$3
  local out; out=$(curl -s "$BASE$url" | python3 -c "import json,sys; d=json.load(sys.stdin); print($expr)" 2>/dev/null)
  if [ -n "$out" ] && [ "$out" != "None" ]; then echo "  PASS  $name -> $out"; pass=$((pass+1))
  else echo "  FAIL  $name (empty/err)"; fail=$((fail+1)); fi
}

echo "== system =="
ck "GET /api/system" 200 /api/system
jck "system.ram.totalGB" /api/system "d['ram']['totalGB']"
jck "system.services" /api/system "list(d['services'].keys())"

echo "== models =="
ck "GET /api/models" 200 /api/models
jck "allmodels count" /api/allmodels "len(d)"

echo "== agents =="
ck "GET /api/agents" 200 /api/agents
jck "agents seeded" /api/agents "len(d)"
ck "GET /api/runs" 200 /api/runs

echo "== brain =="
ck "GET /api/brain/tree" 200 /api/brain/tree
ck "GET /api/brain/graph" 200 /api/brain/graph
ck "brain path-traversal blocked" 400 "/api/brain/file?path=../.zprofile"

echo "== studio =="
ck "GET /api/studio/models" 200 /api/studio/models
ck "GET /api/studio/gallery" 200 /api/studio/gallery

echo "== providers / profiles =="
ck "GET /api/providers" 200 /api/providers
ck "GET /api/profiles" 200 /api/profiles
jck "profiles roles" /api/profiles "d['roles']"
echo "  secret-leak check:"; curl -s "$BASE/api/providers" | grep -qiE 'apikey|sk-ant|sk-proj' && { echo "  FAIL  provider keys leaked"; fail=$((fail+1)); } || { echo "  PASS  no keys in /api/providers"; pass=$((pass+1)); }

echo "== workflows =="
ck "GET /api/workflows" 200 /api/workflows
tmp_fixture_id="smoke-tmp-$$"
tmp_wf_id=$(curl -s -X POST -H 'Content-Type: application/json' -d "{\"id\":\"$tmp_fixture_id\",\"name\":\"__smoke_tmp\",\"nodes\":[{\"id\":\"in\",\"type\":\"input\",\"position\":{\"x\":0,\"y\":0},\"data\":{\"label\":\"In\"}},{\"id\":\"out\",\"type\":\"output\",\"position\":{\"x\":200,\"y\":0},\"data\":{\"label\":\"Out\"}}],\"edges\":[]}" "$BASE/api/workflows" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' 2>/dev/null)
if [ -n "$tmp_wf_id" ]; then echo "  PASS  create temp workflow ($tmp_wf_id)"; pass=$((pass+1)); else echo "  FAIL  create temp workflow"; fail=$((fail+1)); fi
if [ -n "$tmp_wf_id" ]; then ck "delete temp workflow" 200 "/api/workflows/$tmp_wf_id" DELETE; else echo "  FAIL  delete temp workflow (no id)"; fail=$((fail+1)); fi

echo "== workflow runtime primitives =="
primitive_body='{"id":"smoke-primitives","name":"Smoke primitives","settings":{"localOnly":true},"nodes":[{"id":"in","type":"input","position":{"x":0,"y":0},"data":{"label":"Input"}},{"id":"py","type":"python","position":{"x":200,"y":0},"data":{"label":"Python","code":"import json,sys; d=json.load(sys.stdin); print(json.dumps({\"message\":d[\"input\"].upper()}))"}},{"id":"decision","type":"if","position":{"x":400,"y":0},"data":{"label":"Decision","operator":"contains","value":"HELLO"}},{"id":"yes","type":"write-file","position":{"x":600,"y":0},"data":{"label":"Yes artifact","path":"yes.txt"}},{"id":"no","type":"write-file","position":{"x":600,"y":150},"data":{"label":"No artifact","path":"no.txt"}},{"id":"out","type":"output","position":{"x":800,"y":0},"data":{"label":"Output"}}],"edges":[{"id":"e1","source":"in","target":"py"},{"id":"e2","source":"py","target":"decision","data":{"mapping":{"message":"text"}}},{"id":"e3","source":"decision","target":"yes","data":{"condition":"true"}},{"id":"e4","source":"decision","target":"no","data":{"condition":"false"}},{"id":"e5","source":"yes","target":"out"},{"id":"e6","source":"no","target":"out"}]}'
ck "save primitive workflow" 200 /api/workflows POST "$primitive_body"
primitive_run=$(curl -s -X POST -H 'Content-Type: application/json' -d '{"input":"hello studio"}' "$BASE/api/workflows/smoke-primitives/run" | python3 -c 'import json,sys; print(json.load(sys.stdin)["runId"])' 2>/dev/null)
sleep 0.4
primitive_status=$(curl -s "$BASE/api/runs/$primitive_run/detail" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("status"), d.get("result"))' 2>/dev/null)
if [ "$primitive_status" = "done yes.txt" ]; then echo "  PASS  Python + field mapping + decision + artifact runtime"; pass=$((pass+1)); else echo "  FAIL  primitive runtime -> $primitive_status"; fail=$((fail+1)); fi
jck "workflow version snapshot" /api/workflows/smoke-primitives/versions "len(d)"
ck "delete primitive workflow" 200 /api/workflows/smoke-primitives DELETE

approval_body='{"id":"smoke-approval","name":"Smoke approval","nodes":[{"id":"in","type":"input","position":{"x":0,"y":0},"data":{"label":"Input"}},{"id":"approve","type":"human-approval","position":{"x":200,"y":0},"data":{"label":"Approval","message":"Smoke review"}},{"id":"out","type":"output","position":{"x":400,"y":0},"data":{"label":"Output"}}],"edges":[{"id":"e1","source":"in","target":"approve"},{"id":"e2","source":"approve","target":"out"}]}'
ck "save approval workflow" 200 /api/workflows POST "$approval_body"
approval_run=$(curl -s -X POST -H 'Content-Type: application/json' -d '{"input":"approval payload"}' "$BASE/api/workflows/smoke-approval/run" | python3 -c 'import json,sys; print(json.load(sys.stdin)["runId"])' 2>/dev/null)
sleep 0.4
ck "approve paused node" 200 "/api/workflows/runs/$approval_run/nodes/approve/approval" POST '{"decision":"approved","comment":"continue"}'
sleep 0.4
approval_status=$(curl -s "$BASE/api/runs/$approval_run/detail" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status"))' 2>/dev/null)
if [ "$approval_status" = "done" ]; then echo "  PASS  human approval pause/resume"; pass=$((pass+1)); else echo "  FAIL  approval runtime -> $approval_status"; fail=$((fail+1)); fi
ck "delete approval workflow" 200 /api/workflows/smoke-approval DELETE

echo "== bundle =="
ck "GET /api/bundle/export" 200 /api/bundle/export
echo "  bundle secret check:"; curl -s "$BASE/api/bundle/export" | grep -qiE 'apikey|sk-ant|sk-proj' && { echo "  FAIL  bundle leaked keys"; fail=$((fail+1)); } || { echo "  PASS  no keys in bundle"; pass=$((pass+1)); }

echo ""
echo "== RESULT: $pass passed, $fail failed =="
[ $fail -eq 0 ] && exit 0 || exit 1
