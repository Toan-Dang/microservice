#!/usr/bin/env bash
#
# setup-stateful.sh — Tạo RDS Postgres 16 + ElastiCache Valkey + Amazon MQ (RabbitMQ 4.x).
# Dùng chung cho CẢ bậc 1 (ECS Fargate) VÀ bậc 2 (EKS). Chạy 1 lần ở Ngày 1.
#
# Chạy từ ROOT repo:
#   SG_DATA=sg-xxxx POSTGRES_PASSWORD='...' MQ_PASSWORD='...' ./infra/common/setup-stateful.sh
#
# Script chỉ TẠO (create là bất đồng bộ). 3 dịch vụ mất 5–15 phút để available —
# chạy song song ./deploy/push-ecr.sh trong lúc chờ, rồi verify bằng lệnh in ở cuối.
#
# Idempotent: resource đã tồn tại thì bỏ qua, không ghi đè.
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
PREFIX="${PREFIX:-ecommerce}"

POSTGRES_USER="${POSTGRES_USER:-postgres}"
MQ_USER="${MQ_USER:-ecommerce}"

fail() { echo "✗ $*" >&2; exit 1; }
[ -n "${SG_DATA:-}" ]           || fail "Thiếu SG_DATA — chạy ./infra/common/setup-network.sh trước"
[ -n "${POSTGRES_PASSWORD:-}" ] || fail "Thiếu POSTGRES_PASSWORD (>= 8 ký tự, không dấu / @ \" ')"
[ -n "${MQ_PASSWORD:-}" ]       || fail "Thiếu MQ_PASSWORD (Amazon MQ yêu cầu >= 12 ký tự, không khoảng trắng)"
[ ${#MQ_PASSWORD} -ge 12 ]      || fail "MQ_PASSWORD phải >= 12 ký tự (yêu cầu của Amazon MQ)"

VPC_ID="${VPC_ID:-$(aws ec2 describe-vpcs --region "$AWS_REGION" \
  --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)}"
# Amazon MQ single-instance chỉ nhận 1 subnet; RDS/ElastiCache subnet group cần >= 2 (khác AZ).
SUBNETS=($(aws ec2 describe-subnets --region "$AWS_REGION" \
  --filters "Name=vpc-id,Values=$VPC_ID" --query 'Subnets[].SubnetId' --output text))
[ ${#SUBNETS[@]} -ge 2 ] || fail "Cần >= 2 subnet trong VPC $VPC_ID"

echo "▸ Region=$AWS_REGION  VPC=$VPC_ID  SG_DATA=$SG_DATA"
echo "▸ Subnets: ${SUBNETS[*]}"
echo

# ============================ 1. RDS Postgres ============================
DB_ID="${PREFIX}-pg"
if aws rds describe-db-instances --region "$AWS_REGION" --db-instance-identifier "$DB_ID" >/dev/null 2>&1; then
  echo "▸ RDS $DB_ID đã tồn tại — bỏ qua"
else
  echo "▸ Tạo RDS $DB_ID (db.t3.micro, postgres 16)..."
  # PubliclyAccessible: cần để chạy psql tạo 3 database + chạy migration từ máy bạn.
  # An toàn vẫn do sg-data giữ (chỉ mở cho sg-app; IP của bạn mở/đóng tạm thời).
  aws rds create-db-instance --region "$AWS_REGION" \
    --db-instance-identifier "$DB_ID" \
    --db-instance-class db.t3.micro \
    --engine postgres --engine-version 16 \
    --allocated-storage 20 --storage-type gp3 \
    --master-username "$POSTGRES_USER" \
    --master-user-password "$POSTGRES_PASSWORD" \
    --vpc-security-group-ids "$SG_DATA" \
    --backup-retention-period 0 \
    --no-multi-az --publicly-accessible \
    --no-deletion-protection >/dev/null
fi

# ========================= 2. ElastiCache (Valkey) =========================
CACHE_ID="${PREFIX}-redis"
SUBNET_GROUP="${PREFIX}-cache-subnets"
aws elasticache create-cache-subnet-group --region "$AWS_REGION" \
  --cache-subnet-group-name "$SUBNET_GROUP" \
  --cache-subnet-group-description "$PREFIX" \
  --subnet-ids "${SUBNETS[@]}" >/dev/null 2>&1 || true

if aws elasticache describe-cache-clusters --region "$AWS_REGION" --cache-cluster-id "$CACHE_ID" >/dev/null 2>&1; then
  echo "▸ ElastiCache $CACHE_ID đã tồn tại — bỏ qua"
else
  # VALKEY thay vì Redis OSS: rẻ hơn 20% cho node-based cluster và wire-compatible hoàn toàn
  # → `ioredis` và URL `redis://` giữ nguyên, KHÔNG sửa một dòng code nào.
  # (Redis OSS trên ElastiCache dừng ở 7.1; Valkey là nhánh đang được phát triển tiếp.)
  #
  # Vì sao DÒ thay vì hardcode: tài liệu AWS đang mâu thuẫn với chính nó — phần mô tả
  # CreateCacheCluster nói "Memcached, Valkey or Redis OSS", nhưng bảng tham số `Engine` vẫn chỉ
  # liệt kê `memcached | redis`. Thay vì đoán, hỏi thẳng API rồi mới quyết định.
  CACHE_ENGINE="valkey"
  CACHE_VER="${CACHE_ENGINE_VERSION:-}"
  if [ -z "$CACHE_VER" ]; then
    CACHE_VER=$(aws elasticache describe-cache-engine-versions --region "$AWS_REGION" \
      --engine valkey --query 'CacheEngineVersions[-1].EngineVersion' --output text 2>/dev/null || echo "")
  fi
  if [ -z "$CACHE_VER" ] || [ "$CACHE_VER" = "None" ]; then
    echo "  ⚠️  Region/CLI này chưa nhận engine 'valkey' → quay về redis 7.1 (đắt hơn ~20%)."
    echo "     Nâng AWS CLI rồi tạo lại để lấy giá Valkey:  aws --version"
    CACHE_ENGINE="redis"; CACHE_VER="7.1"
  fi

  echo "▸ Tạo ElastiCache $CACHE_ID (cache.t3.micro, ${CACHE_ENGINE} ${CACHE_VER})..."
  # KHÔNG bật transit-encryption: giữ URL redis:// giống local, khỏi phải thêm option tls cho ioredis.
  aws elasticache create-cache-cluster --region "$AWS_REGION" \
    --cache-cluster-id "$CACHE_ID" \
    --engine "$CACHE_ENGINE" --engine-version "$CACHE_VER" \
    --cache-node-type cache.t3.micro --num-cache-nodes 1 \
    --cache-subnet-group-name "$SUBNET_GROUP" \
    --security-group-ids "$SG_DATA" >/dev/null
fi

# ======================= 3. Amazon MQ (RabbitMQ) =======================
BROKER="${PREFIX}-mq"
if aws mq list-brokers --region "$AWS_REGION" --query "BrokerSummaries[?BrokerName=='$BROKER']" --output text | grep -q .; then
  echo "▸ Amazon MQ $BROKER đã tồn tại — bỏ qua"
else
  # Khai engine-version rõ ràng thay vì để mặc định, để biết chắc mình đang chạy bản nào.
  # AWS khuyến nghị 4.2 (3.13 vẫn được hỗ trợ; 3.12 đã hết hạn 17/03/2025).
  # RabbitMQ 4.x bỏ global QoS (basic.qos global=true) — code ở đây dùng channel.prefetch(10)
  # là per-consumer (amqplib mặc định global=false) nên KHÔNG bị ảnh hưởng.
  MQ_VER="${MQ_ENGINE_VERSION:-}"
  if [ -z "$MQ_VER" ]; then
    MQ_VER=$(aws mq describe-broker-engine-types --region "$AWS_REGION" --engine-type RABBITMQ \
      --query 'BrokerEngineTypes[0].EngineVersions[0].Name' --output text 2>/dev/null || echo "")
  fi
  [ -n "$MQ_VER" ] && [ "$MQ_VER" != "None" ] || MQ_VER="4.2"

  echo "▸ Tạo Amazon MQ $BROKER (mq.t3.micro, RabbitMQ ${MQ_VER}, SINGLE_INSTANCE)..."
  aws mq create-broker --region "$AWS_REGION" \
    --broker-name "$BROKER" \
    --engine-type RABBITMQ --engine-version "$MQ_VER" \
    --host-instance-type mq.t3.micro \
    --deployment-mode SINGLE_INSTANCE \
    --publicly-accessible \
    --auto-minor-version-upgrade \
    --users "Username=$MQ_USER,Password=$MQ_PASSWORD" >/dev/null
fi

cat <<SUMMARY

⏳ Cả 3 đang provision (5–15 phút). Trong lúc chờ: chạy ./deploy/push-ecr.sh

Lấy endpoint khi đã available:

  aws rds describe-db-instances --region $AWS_REGION --db-instance-identifier $DB_ID \\
    --query 'DBInstances[0].[DBInstanceStatus,Endpoint.Address]' --output text

  aws elasticache describe-cache-clusters --region $AWS_REGION --cache-cluster-id $CACHE_ID \\
    --show-cache-node-info \\
    --query 'CacheClusters[0].[CacheClusterStatus,CacheNodes[0].Endpoint.Address]' --output text

  aws mq list-brokers --region $AWS_REGION \\
    --query "BrokerSummaries[?BrokerName=='$BROKER'].[BrokerState,BrokerId]" --output text
  # rồi:  aws mq describe-broker --region $AWS_REGION --broker-id <BrokerId> \\
  #         --query 'BrokerInstances[0].Endpoints' --output text     → amqps://...:5671

Tiếp theo:
  1. Tạo 3 database trên RDS  → infra/common/03-stateful.md §1
  2. Đẩy secret vào Secrets Manager → infra/common/04-secrets.md
SUMMARY
