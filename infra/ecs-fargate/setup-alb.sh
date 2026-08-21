#!/usr/bin/env bash
#
# setup-alb.sh — Bậc 1, Ngày 2.3: ALB + target group + listener cho api-gateway.
# Chạy từ ROOT repo:  SG_ALB=sg-xxx ./infra/ecs-fargate/setup-alb.sh
#
# CHỈ api-gateway gắn ALB. 4 service còn lại không public — đúng CLAUDE.md:
# "Không service nào expose REST ra ngoài trừ api-gateway".
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
PREFIX="${PREFIX:-ecommerce}"

fail() { echo "✗ $*" >&2; exit 1; }
[ -n "${SG_ALB:-}" ] || fail "Thiếu SG_ALB — chạy ./infra/common/setup-network.sh trước"

VPC_ID="${VPC_ID:-$(aws ec2 describe-vpcs --region "$AWS_REGION" \
  --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)}"
SUBNETS=($(aws ec2 describe-subnets --region "$AWS_REGION" \
  --filters "Name=vpc-id,Values=$VPC_ID" --query 'Subnets[].SubnetId' --output text))
[ ${#SUBNETS[@]} -ge 2 ] || fail "ALB cần >= 2 subnet ở 2 AZ khác nhau"

# ---------- Target group ----------
# targetType=ip là BẮT BUỘC với Fargate (awsvpc mode): target là ENI của task, không phải instance.
TG_ARN=$(aws elbv2 describe-target-groups --region "$AWS_REGION" \
  --names "${PREFIX}-gw-tg" --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)
if [ -z "$TG_ARN" ] || [ "$TG_ARN" = "None" ]; then
  TG_ARN=$(aws elbv2 create-target-group --region "$AWS_REGION" \
    --name "${PREFIX}-gw-tg" --protocol HTTP --port 3000 --target-type ip --vpc-id "$VPC_ID" \
    --health-check-path /health \
    --health-check-interval-seconds 30 \
    --health-check-timeout-seconds 5 \
    --healthy-threshold-count 2 --unhealthy-threshold-count 3 \
    --query 'TargetGroups[0].TargetGroupArn' --output text)
fi
echo "✓ Target group: $TG_ARN"

# ---------- ALB ----------
ALB_ARN=$(aws elbv2 describe-load-balancers --region "$AWS_REGION" \
  --names "${PREFIX}-alb" --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || true)
if [ -z "$ALB_ARN" ] || [ "$ALB_ARN" = "None" ]; then
  ALB_ARN=$(aws elbv2 create-load-balancer --region "$AWS_REGION" \
    --name "${PREFIX}-alb" --type application --scheme internet-facing \
    --security-groups "$SG_ALB" --subnets "${SUBNETS[@]}" \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text)
fi

# ---------- Listener :80 ----------
aws elbv2 describe-listeners --region "$AWS_REGION" --load-balancer-arn "$ALB_ARN" \
  --query 'Listeners[?Port==`80`]' --output text | grep -q . \
  || aws elbv2 create-listener --region "$AWS_REGION" \
       --load-balancer-arn "$ALB_ARN" --protocol HTTP --port 80 \
       --default-actions "Type=forward,TargetGroupArn=$TG_ARN" >/dev/null

ALB_DNS=$(aws elbv2 describe-load-balancers --region "$AWS_REGION" \
  --load-balancer-arns "$ALB_ARN" --query 'LoadBalancers[0].DNSName' --output text)

cat <<SUMMARY

✅ ALB sẵn sàng.

  export TG_ARN=$TG_ARN
  export ALB_DNS=$ALB_DNS

Verify sau khi create-services.sh chạy xong (~2 phút cho task khởi động):
  curl http://$ALB_DNS/health

⚠️ Target group sẽ "unhealthy" cho tới khi có ECS service đăng ký target — đó là bình thường lúc này.
⚠️ Health check /health đã @SkipThrottle() trong code — nếu không, ALB gọi 2 lần/30s có thể ăn 429.
SUMMARY
