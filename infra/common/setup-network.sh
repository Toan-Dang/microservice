#!/usr/bin/env bash
#
# setup-network.sh — Tạo 3 security group (sg-alb / sg-app / sg-data) trong default VPC.
# Dùng chung cho CẢ ECS Fargate (bậc 1) VÀ EKS (bậc 2). Chạy 1 lần ở Ngày 1.
#
# Chạy từ ROOT repo:  ./infra/common/setup-network.sh
#
# Idempotent: SG đã tồn tại thì tái sử dụng, rule đã có thì bỏ qua (nuốt Duplicate*).
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
PREFIX="${PREFIX:-ecommerce}"

VPC_ID="${VPC_ID:-$(aws ec2 describe-vpcs --region "$AWS_REGION" \
  --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)}"
[ "$VPC_ID" != "None" ] || { echo "✗ Không tìm thấy default VPC ở $AWS_REGION — set VPC_ID thủ công"; exit 1; }

echo "▸ Region: $AWS_REGION   VPC: $VPC_ID"

# ---------- helper ----------
ensure_sg() {  # $1=name  $2=description  → in ra sg-id
  local name="$1" desc="$2" id
  id=$(aws ec2 describe-security-groups --region "$AWS_REGION" \
        --filters "Name=vpc-id,Values=$VPC_ID" "Name=group-name,Values=$name" \
        --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo None)
  if [ "$id" = "None" ] || [ -z "$id" ]; then
    id=$(aws ec2 create-security-group --region "$AWS_REGION" \
          --group-name "$name" --description "$desc" --vpc-id "$VPC_ID" \
          --query GroupId --output text)
  fi
  echo "$id"
}

# Nuốt lỗi trùng rule để script chạy lại được nhiều lần.
allow() {  # allow <sg-id> <port> <--cidr X | --sg Y>
  local sg="$1" port="$2" kind="$3" src="$4"
  local args=(--region "$AWS_REGION" --group-id "$sg" --protocol tcp --port "$port")
  if [ "$kind" = "--cidr" ]; then args+=(--cidr "$src"); else args+=(--source-group "$src"); fi
  aws ec2 authorize-security-group-ingress "${args[@]}" >/dev/null 2>&1 \
    || echo "  (đã có) $sg :$port ← $src"
}

# ---------- 1. sg-alb : internet → ALB ----------
SG_ALB=$(ensure_sg "${PREFIX}-sg-alb" "ALB public ingress")
allow "$SG_ALB" 80  --cidr 0.0.0.0/0
allow "$SG_ALB" 443 --cidr 0.0.0.0/0   # để sẵn, dùng khi có ACM cert

# ---------- 2. sg-app : ALB → gateway, và gRPC giữa các task ----------
SG_APP=$(ensure_sg "${PREFIX}-sg-app" "Fargate tasks / EKS pods")
allow "$SG_APP" 3000 --sg "$SG_ALB"
# gRPC nội bộ: nguồn là CHÍNH sg-app (task gọi task). Quên rule này ⇒ DEADLINE_EXCEEDED ⇒ HTTP 504.
for p in 50051 50052 50053; do allow "$SG_APP" "$p" --sg "$SG_APP"; done

# ---------- 3. sg-data : chỉ app mới vào được stateful ----------
SG_DATA=$(ensure_sg "${PREFIX}-sg-data" "RDS / ElastiCache / Amazon MQ")
allow "$SG_DATA" 5432 --sg "$SG_APP"   # RDS Postgres
allow "$SG_DATA" 6379 --sg "$SG_APP"   # ElastiCache Valkey (giao thức Redis)
allow "$SG_DATA" 5671 --sg "$SG_APP"   # Amazon MQ AMQPS (TLS) — KHÔNG phải 5672

cat <<SUMMARY

✅ Xong. Lưu lại 3 giá trị này (mọi bước sau đều cần):

  export VPC_ID=$VPC_ID
  export SG_ALB=$SG_ALB
  export SG_APP=$SG_APP
  export SG_DATA=$SG_DATA

Bước tiếp: ./infra/common/setup-stateful.sh
SUMMARY
