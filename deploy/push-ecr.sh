#!/usr/bin/env bash
#
# push-ecr.sh — Build 5 image (stage `production`) và push lên Amazon ECR.
# Chạy từ ROOT repo:  ./deploy/push-ecr.sh
#
# Idempotent: tạo repo nếu chưa có, bỏ qua nếu đã tồn tại. Chạy lại bao nhiêu lần cũng được.
#
# Vì sao build từ ROOT: Dockerfile COPY cả `proto/` và `services/<svc>/`, nên context phải là
#   gốc repo (dấu `.`), không phải thư mục service.
# Vì sao --platform linux/amd64: Fargate chạy x86_64. Build trên Mac Apple Silicon (arm64) mà
#   quên cờ này → task chết ngay với "exec format error".
# Vì sao --target production: multi-stage build, chỉ lấy image cuối đã prune (nhẹ, không có devDeps).

set -euo pipefail

# ---------- Cấu hình (đọc từ env, có default) ----------
AWS_REGION="${AWS_REGION:-us-east-1}"
# TAG mặc định = git short SHA để mỗi commit ra 1 image truy vết được; fallback "latest".
TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo latest)}"

SERVICES=(api-gateway auth-service product-service order-service notification-worker)

# ---------- Lấy Account ID động (không hardcode) ----------
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

echo "▸ Region:   ${AWS_REGION}"
echo "▸ Registry: ${REGISTRY}"
echo "▸ Tag:      ${TAG}"
echo

# ---------- Đăng nhập ECR (token có hạn ~12h) ----------
echo "▸ Đăng nhập ECR..."
aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${REGISTRY}"

# ---------- Build + push từng service ----------
for svc in "${SERVICES[@]}"; do
  echo
  echo "==================== ${svc} ===================="

  # Tạo repo nếu chưa có (idempotent: nuốt lỗi RepositoryAlreadyExistsException)
  aws ecr describe-repositories --repository-names "${svc}" --region "${AWS_REGION}" >/dev/null 2>&1 \
    || aws ecr create-repository \
         --repository-name "${svc}" \
         --region "${AWS_REGION}" \
         --image-scanning-configuration scanOnPush=true >/dev/null

  IMAGE="${REGISTRY}/${svc}"

  echo "▸ Build ${svc} (linux/amd64, target=production)..."
  docker build \
    --platform linux/amd64 \
    --target production \
    --build-arg "SERVICE_DIR=services/${svc}" \
    -f "services/${svc}/Dockerfile" \
    -t "${IMAGE}:${TAG}" \
    -t "${IMAGE}:latest" \
    .

  echo "▸ Push ${svc}..."
  docker push "${IMAGE}:${TAG}"
  docker push "${IMAGE}:latest"
done

echo
echo "✅ Xong. 5 image đã lên ECR:"
for svc in "${SERVICES[@]}"; do
  echo "   ${REGISTRY}/${svc}:${TAG}"
done
echo
echo "Kiểm tra:  aws ecr list-images --repository-name api-gateway --region ${AWS_REGION}"
