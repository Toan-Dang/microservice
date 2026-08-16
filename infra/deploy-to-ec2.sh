#!/usr/bin/env bash
# Deploy tay lên EC2 (Ngày 5) — copy config lên host rồi pull image từ ECR & up stack.
# Dùng cho lần deploy đầu tiên / deploy thủ công. CI/CD (Route B) đi qua CodeDeploy hooks
# ở cicd/aws/scripts/, KHÔNG dùng file này.
#
# Chạy:  EC2_IP=1.2.3.4 EC2_SSH_KEY=~/.ssh/ecommerce.pem ./infra/deploy-to-ec2.sh
#
# Tham số đọc từ biến môi trường:
#   EC2_IP        (bắt buộc) IP/DNS public của EC2
#   EC2_SSH_KEY   (bắt buộc) đường dẫn file .pem
#   EC2_USER      user SSH                         (mặc định: ec2-user)
#   APP_DIR       thư mục app trên EC2             (mặc định: /home/ec2-user/app)
#   ENV_FILE      file .env local sẽ copy lên      (mặc định: .env ở gốc repo)
#   ECR_REGISTRY  <account>.dkr.ecr.<region>.amazonaws.com  (fallback: đọc từ ENV_FILE)
#   AWS_REGION    region của ECR                   (fallback: ENV_FILE, rồi ap-southeast-1)
#   TAG           tag image cần deploy             (fallback: ENV_FILE, rồi latest)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

EC2_USER="${EC2_USER:-ec2-user}"
APP_DIR="${APP_DIR:-/home/ec2-user/app}"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env}"
COMPOSE_FILE="$REPO_ROOT/docker-compose.prod.yml"
INIT_DB_SCRIPT="$REPO_ROOT/infra/init-multiple-dbs.sh"

# ---------- Nạp giá trị thiếu từ .env ----------
# Biến truyền qua môi trường có ĐỘ ƯU TIÊN CAO HƠN .env, nên phải giữ lại trước khi source.
_env_ecr="${ECR_REGISTRY:-}"
_env_region="${AWS_REGION:-}"
_env_tag="${TAG:-}"
if [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE"; set +a
fi
ECR_REGISTRY="${_env_ecr:-${ECR_REGISTRY:-}}"
AWS_REGION="${_env_region:-${AWS_REGION:-ap-southeast-1}}"
TAG="${_env_tag:-${TAG:-latest}}"

# ---------- Preflight ----------
fail() { echo "✗ $*" >&2; exit 1; }

[ -n "${EC2_IP:-}" ]      || fail "Thiếu EC2_IP"
[ -n "${EC2_SSH_KEY:-}" ] || fail "Thiếu EC2_SSH_KEY (đường dẫn file .pem)"
[ -n "$ECR_REGISTRY" ]    || fail "Thiếu ECR_REGISTRY (đặt trong .env hoặc truyền qua env)"

EC2_SSH_KEY="${EC2_SSH_KEY/#\~/$HOME}"   # tự expand ~ khi biến được truyền dạng chuỗi
[ -f "$EC2_SSH_KEY" ]     || fail "Không thấy SSH key: $EC2_SSH_KEY"
[ -f "$COMPOSE_FILE" ]    || fail "Không thấy $COMPOSE_FILE"
[ -f "$INIT_DB_SCRIPT" ]  || fail "Không thấy $INIT_DB_SCRIPT"
[ -f "$ENV_FILE" ]        || fail "Không thấy $ENV_FILE — tạo từ .env.example (chứa POSTGRES_PASSWORD, JWT_SECRET...)"

SSH_OPTS=(-i "$EC2_SSH_KEY" -o StrictHostKeyChecking=accept-new)
REMOTE="$EC2_USER@$EC2_IP"

echo "→ Deploy tới $REMOTE:$APP_DIR  (registry=$ECR_REGISTRY, tag=$TAG, region=$AWS_REGION)"

# ---------- 1. Copy config lên EC2 ----------
# init-multiple-dbs.sh phải nằm ở $APP_DIR/infra/ vì compose bind-mount đường dẫn ./infra/...
ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p '$APP_DIR/infra'"

scp "${SSH_OPTS[@]}" "$COMPOSE_FILE"   "$REMOTE:$APP_DIR/docker-compose.prod.yml"
scp "${SSH_OPTS[@]}" "$ENV_FILE"       "$REMOTE:$APP_DIR/.env"
scp "${SSH_OPTS[@]}" "$INIT_DB_SCRIPT" "$REMOTE:$APP_DIR/infra/init-multiple-dbs.sh"

# .env chứa secret → chỉ owner đọc được. Script init cần bit +x (postgres entrypoint tự chạy).
ssh "${SSH_OPTS[@]}" "$REMOTE" "chmod 600 '$APP_DIR/.env' && chmod +x '$APP_DIR/infra/init-multiple-dbs.sh'"
echo "✓ Đã copy docker-compose.prod.yml, .env, infra/init-multiple-dbs.sh"

# ---------- 2. Login ECR + up stack ----------
# Heredoc quote 'REMOTE_SCRIPT' để local shell KHÔNG expand — giá trị truyền qua env phía trước bash -s.
# EC2 dùng IAM instance profile (AmazonEC2ContainerRegistryReadOnly) nên không cần key AWS trên host.
ssh "${SSH_OPTS[@]}" "$REMOTE" \
  "APP_DIR='$APP_DIR' AWS_REGION='$AWS_REGION' ECR_REGISTRY='$ECR_REGISTRY' TAG='$TAG' bash -s" \
  <<'REMOTE_SCRIPT'
set -euo pipefail
cd "$APP_DIR"

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

# TAG/ECR_REGISTRY export ra để compose interpolate vào ${ECR_REGISTRY}/<svc>:${TAG}
export ECR_REGISTRY TAG
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker image prune -f

docker compose -f docker-compose.prod.yml ps
REMOTE_SCRIPT

# ---------- 3. Health check ----------
echo "→ Đợi api-gateway sẵn sàng..."
for i in $(seq 1 12); do
  if curl -fsS --max-time 5 "http://$EC2_IP/health" >/dev/null 2>&1; then
    echo "✓ Deploy OK — http://$EC2_IP/health"
    exit 0
  fi
  sleep 5
done

echo "✗ Health check thất bại sau 60s. Xem log:" >&2
echo "    ssh -i $EC2_SSH_KEY $REMOTE 'cd $APP_DIR && docker compose -f docker-compose.prod.yml logs --tail=50'" >&2
exit 1
