#!/usr/bin/env bash
#
# apply-manifests.sh — envsubst placeholder trong manifest rồi kubectl apply.
# Chạy từ ROOT repo:  TAG=<git-sha> ./deploy/eks/apply-manifests.sh [file...]
#
# Manifest ở infra/eks/manifests/ để ${ACCOUNT_ID}/${AWS_REGION}/${TAG} trong `image:`
# → `kubectl apply -f` thẳng sẽ apply nguyên chuỗi placeholder và pod ImagePullBackOff.
#
# Mặc định KHÔNG apply: 02-secret.example.yaml (dùng create-secrets.sh),
#                       21-ingress.yaml (Ngày 7, cần ALB Controller trước),
#                       30-hpa.yaml (Ngày 9, cần metrics-server),
#                       40-migration-job.yaml (chạy riêng khi cần),
#                       90-postgres-statefulset.yaml (bài bonus Ngày 11).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST_DIR="$REPO_ROOT/infra/eks/manifests"
AWS_REGION="${AWS_REGION:-us-east-1}"
TAG="${TAG:-$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo latest)}"
ACCOUNT_ID="${ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
export AWS_REGION TAG ACCOUNT_ID

command -v envsubst >/dev/null || { echo "✗ Thiếu envsubst (gói gettext)"; exit 1; }

if [ $# -gt 0 ]; then
  FILES=("$@")
else
  FILES=(
    "$MANIFEST_DIR/00-namespace.yaml"
    "$MANIFEST_DIR/01-configmap.yaml"
    "$MANIFEST_DIR/10-auth-service.yaml"
    "$MANIFEST_DIR/11-product-service.yaml"
    "$MANIFEST_DIR/12-order-service.yaml"
    "$MANIFEST_DIR/13-notification-worker.yaml"
    "$MANIFEST_DIR/20-api-gateway.yaml"
  )
fi

echo "▸ Account=$ACCOUNT_ID Region=$AWS_REGION Tag=$TAG"
for f in "${FILES[@]}"; do
  echo "── $(basename "$f")"
  envsubst '${ACCOUNT_ID} ${AWS_REGION} ${TAG}' < "$f" | kubectl apply -f -
done

echo
echo "kubectl get pods -n ecommerce -w"
