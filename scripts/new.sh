#!/usr/bin/env bash
set -euo pipefail

name="${1:?사용법: ./scripts/new.sh <프로젝트-이름>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/projects/$name"

[ -e "$dir" ] && { echo "이미 존재: $dir"; exit 1; }

mkdir -p "$dir"
cat > "$dir/README.md" <<EOF
# $name

한 줄 설명을 여기에 적으세요.
EOF

python3 "$root/scripts/update_index.py"
echo "생성됨: projects/$name"
