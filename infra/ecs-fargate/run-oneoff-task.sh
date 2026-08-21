#!/usr/bin/env bash
#
# run-oneoff-task.sh — Bậc 1, Ngày 2.4: chạy migration / seed bằng ECS run-task (one-off).
#
#   ./infra/ecs-fargate/run-oneoff-task.sh migration            # migrate cả 3 service có DB
#   ./infra/ecs-fargate/run-oneoff-task.sh migration auth-service
#   ./infra/ecs-fargate/run-oneoff-task.sh seed                 # seed auth + product (idempotent)
#
# VÌ SAO KHÔNG dùng `npm run migration:run`:
#   script đó gọi `typeorm-ts-node-commonjs -d src/database/data-source.ts` — cần ts-node
#   (devDependency) và thư mục src/. Image production đã `npm prune --production` và CHỈ copy dist/
#   → chạy sẽ fail "ts-node not found". Ở đây gọi thẳng CLI của typeorm trên bản đã build:
#     node node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js
#   (typeorm là dependency runtime nên CÓ trong image production.)
#   `dist/database/data-source.js` đọc DATABASE_URL từ env — task def đã inject sẵn từ Secrets Manager.
#
# Seed thì đã có sẵn script đúng: `npm run seed:prod` → node dist/database/seeds/run-seed.js
# (KHÔNG dùng `npm run seed`, script đó là ts-node trên src/).
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
CLUSTER="${CLUSTER:-ecommerce}"

fail() { echo "✗ $*" >&2; exit 1; }
[ -n "${SG_APP:-}" ] || fail "Thiếu SG_APP"

ACTION="${1:-}"
[ -n "$ACTION" ] || fail "Dùng: $0 <migration|seed> [service]"

case "$ACTION" in
  migration) DEFAULT_SVCS="auth-service product-service order-service"
             CMD_ARGS='"node","node_modules/typeorm/cli.js","migration:run","-d","dist/database/data-source.js"' ;;
  seed)      DEFAULT_SVCS="auth-service product-service"
             CMD_ARGS='"npm","run","seed:prod"' ;;
  *)         fail "Action phải là migration hoặc seed" ;;
esac

SVCS="${2:-$DEFAULT_SVCS}"

VPC_ID="${VPC_ID:-$(aws ec2 describe-vpcs --region "$AWS_REGION" \
  --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)}"
SUBNETS=$(aws ec2 describe-subnets --region "$AWS_REGION" \
  --filters "Name=vpc-id,Values=$VPC_ID" --query 'Subnets[].SubnetId' --output text | tr '\t' ',')

for svc in $SVCS; do
  echo
  echo "==================== $ACTION: $svc ===================="
  TASK_ARN=$(aws ecs run-task --region "$AWS_REGION" --cluster "$CLUSTER" \
    --launch-type FARGATE --task-definition "$svc" \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG_APP],assignPublicIp=ENABLED}" \
    --overrides "{\"containerOverrides\":[{\"name\":\"$svc\",\"command\":[$CMD_ARGS]}]}" \
    --query 'tasks[0].taskArn' --output text)

  echo "▸ Task: $TASK_ARN — chờ chạy xong..."
  aws ecs wait tasks-stopped --region "$AWS_REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN"

  read -r EXIT_CODE REASON < <(aws ecs describe-tasks --region "$AWS_REGION" --cluster "$CLUSTER" \
    --tasks "$TASK_ARN" --query 'tasks[0].containers[0].[exitCode,reason]' --output text)

  if [ "$EXIT_CODE" = "0" ]; then
    echo "✓ $svc: $ACTION OK"
  else
    echo "✗ $svc: exit=$EXIT_CODE reason=$REASON"
    echo "  Log:  aws logs tail /ecs/$svc --region $AWS_REGION --since 10m"
  fi
done

cat <<'SUMMARY'

Xem log chi tiết (task one-off ghi cùng log group với service):
  aws logs tail /ecs/auth-service --region us-east-1 --since 10m

Seeder idempotent theo key nghiệp vụ (name/email) → chạy lại nhiều lần vô hại.
Migration idempotent sẵn (typeorm ghi bảng `migrations`).
SUMMARY
