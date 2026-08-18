#!/usr/bin/env bash
#
# create-secrets.sh — Đọc AWS Secrets Manager → tạo k8s Secret "app-secret".
# Chạy từ ROOT repo:  ./deploy/eks/create-secrets.sh
#
# Vì sao không viết tay YAML: để giá trị thật chỉ tồn tại ở 1 nơi (Secrets Manager) và
# không bao giờ nằm trong file trên đĩa/git. Bậc 1 (ECS) đọc cùng secret đó qua execution role.
#
# ⚠️ k8s Secret chỉ base64, KHÔNG mã hoá — nó nằm plaintext trong etcd.
#    Đường chuẩn production: External Secrets Operator / Secrets Store CSI Driver + IRSA.
#    Cách này chấp nhận được cho learning, và biết rõ nó khác gì là điểm cộng phỏng vấn.
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
NAMESPACE="${NAMESPACE:-ecommerce}"
SECRET_NAME="${SECRET_NAME:-ecommerce/app}"

command -v jq >/dev/null || { echo "✗ Cần jq"; exit 1; }

JSON=$(aws secretsmanager get-secret-value --region "$AWS_REGION" \
        --secret-id "$SECRET_NAME" --query SecretString --output text)

# --from-literal cho từng key trong secret JSON. Dùng mảng để giá trị có ký tự lạ (@ / :) vẫn an toàn.
ARGS=()
while IFS= read -r k; do
  ARGS+=(--from-literal="${k}=$(jq -r --arg k "$k" '.[$k]' <<<"$JSON")")
done < <(jq -r 'keys[]' <<<"$JSON")

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

# create --dry-run | apply: idempotent, cập nhật được secret đã tồn tại.
kubectl create secret generic app-secret -n "$NAMESPACE" "${ARGS[@]}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "✅ Secret app-secret (ns=$NAMESPACE) có các key:"
jq -r 'keys[] | "   - " + .' <<<"$JSON"
echo
echo "Kiểm tra (KHÔNG in giá trị):  kubectl describe secret app-secret -n $NAMESPACE"
