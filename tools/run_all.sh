#!/usr/bin/env bash
# 一条命令重建 + 验收：Excel -> 模型自检 -> data.js -> 浏览器端 E2E
set -euo pipefail
cd "$(dirname "$0")/.."
python3 tools/parse_quiz.py
node tools/browser_check.mjs
