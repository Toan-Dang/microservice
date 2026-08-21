#!/usr/bin/env bash
#
# create-services.sh — Bậc 1, Ngày 2.2: tạo 5 ECS service (Fargate).
# Chạy từ ROOT repo:
#   CLUSTER=ecommerce NS_ID=ns-xxx SG_APP=sg-xxx TG_ARN=arn:... ./infra/ecs-fargate/create-services.sh
#
# Mỗi service:
#   - đăng ký Cloud Map  → <svc>.microservice.local  (gRPC service discovery)
#   - đặt trong public subnet + assignPublicIp=ENABLED (kéo ECR không cần NAT)
#   - desiredCount=1
# Riêng api-gateway thêm: gắn target group của ALB + healthCheckGracePeriodSeconds.
#
# Idempotent: service đã tồn tại → update-service thay vì create.
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
CLUSTER="${CLUSTER:-ecommerce}"

fail() { echo "✗ $*" >&2; exit 1; }
[ -n "${NS_ID:-}" ]  || fail "Thiếu NS_ID (Cloud Map) — chạy setup-cluster.sh trước"
[ -n "${SG_APP:-}" ] || fail "Thiếu SG_APP — chạy infra/common/setup-network.sh trước"
[ -n "${TG_ARN:-}" ] || fail "Thiếu TG_ARN — chạy setup-alb.sh trước"

VPC_ID="${VPC_ID:-$(aws ec2 describe-vpcs --region "$AWS_REGION" \
  --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)}"
SUBNETS=$(aws ec2 describe-subnets --region "$AWS_REGION" \
  --filters "Name=vpc-id,Values=$VPC_ID" --query 'Subnets[].SubnetId' --output text | tr '\t' ',')
NET="awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG_APP],assignPublicIp=ENABLED}"

# ---------- Cloud Map service (1 cho mỗi ECS service) ----------
ensure_discovery() {  # $1=svc  → in ra arn
  local svc="$1" arn
  arn=$(aws servicediscovery list-services --region "$AWS_REGION" \
        --filters "Name=NAMESPACE_ID,Values=$NS_ID" \
        --query "Services[?Name=='$svc'].Arn" --output text)
  if [ -z "$arn" ]; then
    # A record TTL 15s: task chết/tạo lại thì client hết cache nhanh.
    # RoutingPolicy MULTIVALUE = tất cả IP task khoẻ đều trả về (client-side LB của gRPC).
    arn=$(aws servicediscovery create-service --region "$AWS_REGION" \
      --name "$svc" --namespace-id "$NS_ID" \
      --dns-config "NamespaceId=$NS_ID,RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=15}]" \
      --health-check-custom-config FailureThreshold=1 \
      --query 'Service.Arn' --output text)
  fi
  echo "$arn"
}

create_or_update() {  # $1=svc  $2...=tuỳ chọn thêm cho create-service
  local svc="$1"; shift
  local sd_arn; sd_arn=$(ensure_discovery "$svc")

  if aws ecs describe-services --region "$AWS_REGION" --cluster "$CLUSTER" --services "$svc" \
       --query 'services[?status==`ACTIVE`]' --output text | grep -q .; then
    echo "▸ $svc đã tồn tại → update sang task def mới nhất"
    aws ecs update-service --region "$AWS_REGION" --cluster "$CLUSTER" --service "$svc" \
      --task-definition "$svc" --desired-count 1 --force-new-deployment >/dev/null
  else
    echo "▸ Tạo ECS service $svc"
    aws ecs create-service --region "$AWS_REGION" --cluster "$CLUSTER" \
      --service-name "$svc" --task-definition "$svc" \
      --launch-type FARGATE --desired-count 1 \
      --network-configuration "$NET" \
      --service-registries "registryArn=$sd_arn" \
      "$@" >/dev/null
  fi
}

# api-gateway: service duy nhất gắn ALB.
# healthCheckGracePeriodSeconds=90 — NestJS boot vài giây + nối Redis; grace quá ngắn thì
# ALB đánh unhealthy và ECS giết task trước khi app kịp sẵn sàng → vòng lặp restart vô tận.
create_or_update api-gateway \
  --load-balancers "targetGroupArn=$TG_ARN,containerName=api-gateway,containerPort=3000" \
  --health-check-grace-period-seconds 90

for svc in auth-service product-service order-service notification-worker; do
  create_or_update "$svc"
done

cat <<'SUMMARY'

✅ Đã tạo/cập nhật 5 ECS service. Task mất ~1–2 phút để RUNNING.

Theo dõi:
  aws ecs describe-services --cluster ecommerce --region us-east-1 \
    --services api-gateway auth-service product-service order-service notification-worker \
    --query 'services[].[serviceName,runningCount,desiredCount]' --output table

Task chết ngay? Xem lý do (đọc stoppedReason TRƯỚC khi mò CloudWatch):
  aws ecs list-tasks --cluster ecommerce --desired-status STOPPED --region us-east-1
  aws ecs describe-tasks --cluster ecommerce --region us-east-1 --tasks <task-arn> \
    --query 'tasks[0].[stoppedReason,containers[0].reason]'

Tiếp: ./infra/ecs-fargate/run-oneoff-task.sh migration   (Ngày 2.4)
SUMMARY
