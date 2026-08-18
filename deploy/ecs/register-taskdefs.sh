#!/usr/bin/env bash
#
# register-taskdefs.sh — Điền placeholder vào 5 task definition rồi đăng ký lên ECS.
# Chạy từ ROOT repo:
#   ACCOUNT_ID=... REDIS_HOST=... SECRET_SUFFIX=... ./deploy/ecs/register-taskdefs.sh
#
# File gốc ở infra/ecs-fargate/taskdef/*.json để placeholder ${ACCOUNT_ID}/${AWS_REGION}/
# ${TAG}/${REDIS_HOST}/${SECRET_SUFFIX} — không commit giá trị thật. Script này envsubst rồi register.
#
# Chạy lại mỗi lần đổi env/secret/tag → tạo REVISION MỚI (task def là immutable, không sửa tại chỗ).
# Đổi image thôi thì dùng ./deploy/ecs/deploy-ecs.sh cho nhanh.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AWS_REGION="${AWS_REGION:-us-east-1}"
TAG="${TAG:-latest}"
SECRET_NAME="${SECRET_NAME:-ecommerce/app}"
OUT_DIR="${OUT_DIR:-$(mktemp -d)}"

command -v envsubst >/dev/null || { echo "✗ Thiếu envsubst (gói gettext): sudo apt install gettext-base"; exit 1; }

ACCOUNT_ID="${ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"

# Hậu tố 6 ký tự AWS tự sinh cho ARN secret — không đoán được, phải hỏi API.
if [ -z "${SECRET_SUFFIX:-}" ]; then
  SECRET_ARN=$(aws secretsmanager describe-secret --region "$AWS_REGION" \
    --secret-id "$SECRET_NAME" --query ARN --output text)
  SECRET_SUFFIX="${SECRET_ARN##*-}"
fi

[ -n "${REDIS_HOST:-}" ] || { echo "✗ Thiếu REDIS_HOST (endpoint ElastiCache)"; exit 1; }

export ACCOUNT_ID AWS_REGION TAG SECRET_SUFFIX REDIS_HOST

echo "▸ Account=$ACCOUNT_ID Region=$AWS_REGION Tag=$TAG Secret=...-$SECRET_SUFFIX"
echo

for f in "$REPO_ROOT"/infra/ecs-fargate/taskdef/*.json; do
  svc="$(basename "$f" .json)"
  rendered="$OUT_DIR/$svc.json"
  envsubst < "$f" > "$rendered"

  rev=$(aws ecs register-task-definition --region "$AWS_REGION" \
        --cli-input-json "file://$rendered" \
        --query 'taskDefinition.revision' --output text)
  echo "✓ $svc → revision $rev"
done

echo
echo "Bản render (có giá trị thật, KHÔNG commit): $OUT_DIR"
echo "Tiếp: ./infra/ecs-fargate/create-services.sh"
