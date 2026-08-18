#!/usr/bin/env bash
#
# deploy-eks.sh — Deploy image mới lên EKS (dùng tay hoặc gọi từ CI).
# Chạy từ ROOT repo:  TAG=<git-sha> ./deploy/eks/deploy-eks.sh [service...]
#
# `kubectl set image` = rolling update. So với bậc 1: ECS phải register task def revision mới;
# ở đây Deployment tự sinh ReplicaSet mới và giữ lịch sử → có `rollout undo`, thứ ECS không có
# tương đương 1 lệnh.
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
NAMESPACE="${NAMESPACE:-ecommerce}"
TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo latest)}"
ACCOUNT_ID="${ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

SERVICES=("${@:-}")
[ -n "${SERVICES[0]:-}" ] || SERVICES=(api-gateway auth-service product-service order-service notification-worker)

for svc in "${SERVICES[@]}"; do
  echo "▸ $svc → :$TAG"
  # container name == deployment name trong mọi manifest ở infra/eks/manifests/
  kubectl set image "deployment/$svc" "$svc=${REGISTRY}/${svc}:${TAG}" -n "$NAMESPACE"
done

for svc in "${SERVICES[@]}"; do
  # rollout status trả exit code != 0 nếu deploy treo → CI fail đúng lúc, không báo xanh giả.
  kubectl rollout status "deployment/$svc" -n "$NAMESPACE" --timeout=5m
done

echo
echo "✅ Xong. Rollback nếu hỏng:  kubectl rollout undo deployment/<svc> -n $NAMESPACE"
