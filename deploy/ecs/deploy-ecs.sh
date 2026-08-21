#!/usr/bin/env bash
#
# deploy-ecs.sh — Deploy image mới lên ECS (dùng tay hoặc gọi từ CI).
# Chạy từ ROOT repo:  TAG=<git-sha> ./deploy/ecs/deploy-ecs.sh [service...]
#
# Cách làm: lấy task def đang chạy → chỉ thay `image` → register revision mới → update-service.
# Vì sao không dùng thẳng `update-service --force-new-deployment`: lệnh đó chỉ khởi động lại
# task với ĐÚNG task def cũ (tức image cũ, hoặc tag `latest` đã đổi ngầm — không truy vết được
# đang chạy commit nào). Deploy theo SHA và register revision mới là cách audit được.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

AWS_REGION="${AWS_REGION:-us-east-1}"
CLUSTER="${CLUSTER:-ecommerce}"
TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo latest)}"
ACCOUNT_ID="${ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

SERVICES=("${@:-}")
[ -n "${SERVICES[0]:-}" ] || SERVICES=(api-gateway auth-service product-service order-service notification-worker)

command -v jq >/dev/null || { echo "✗ Cần jq"; exit 1; }

# shellcheck source=deploy/ecs/lib.sh
source "$SCRIPT_DIR/lib.sh"

echo "▸ Cluster=$CLUSTER Tag=$TAG"

for svc in "${SERVICES[@]}"; do
  echo
  echo "==================== $svc ===================="

  NEW_TD=$(aws ecs describe-task-definition --region "$AWS_REGION" --task-definition "$svc" \
    --query 'taskDefinition' --output json \
    | jq --arg img "${REGISTRY}/${svc}:${TAG}" '
        .containerDefinitions[0].image = $img
        # bỏ các field chỉ-đọc do AWS trả về; register-task-definition sẽ từ chối nếu còn
        | del(.taskDefinitionArn, .revision, .status, .requiresAttributes,
              .compatibilities, .registeredAt, .registeredBy, .deregisteredAt)')

  REV=$(aws ecs register-task-definition --region "$AWS_REGION" \
        --cli-input-json "$NEW_TD" --query 'taskDefinition.revision' --output text)
  echo "▸ task def revision mới: $svc:$REV"

  # Tên task def family và tên ECS service KHÔNG nhất thiết giống nhau (xem lib.sh).
  SVC_NAME=$(ecs_service_name "$svc")
  aws ecs update-service --region "$AWS_REGION" --cluster "$CLUSTER" \
    --service "$SVC_NAME" --task-definition "$svc:$REV" >/dev/null
  echo "▸ update-service đã gửi → $SVC_NAME"
done

echo
echo "Chờ rolling deploy ổn định (ECS dựng task mới rồi mới rút task cũ):"
echo "  aws ecs wait services-stable --cluster $CLUSTER --region $AWS_REGION --services $(ecs_service_names "${SERVICES[@]}")"
