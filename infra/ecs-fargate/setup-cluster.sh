#!/usr/bin/env bash
#
# setup-cluster.sh — Bậc 1, Ngày 2.1: ECS cluster + IAM role + Cloud Map namespace.
# Chạy từ ROOT repo:  ./infra/ecs-fargate/setup-cluster.sh
#
# Idempotent. Tạo:
#   1. ECS cluster "ecommerce" (Fargate, không có EC2 nào)
#   2. ecommerceTaskExecutionRole  — ECS agent dùng: pull ECR, đọc secret, ghi log
#   3. ecommerceTaskRole           — code trong container dùng: gọi SES
#   4. Cloud Map private DNS namespace "microservice.local" → gRPC service discovery
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
CLUSTER="${CLUSTER:-ecommerce}"
NAMESPACE="${NAMESPACE:-microservice.local}"
SECRET_NAME="${SECRET_NAME:-ecommerce/app}"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
VPC_ID="${VPC_ID:-$(aws ec2 describe-vpcs --region "$AWS_REGION" \
  --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)}"

echo "▸ Account=$ACCOUNT_ID  Region=$AWS_REGION  VPC=$VPC_ID"

# ---------- 1. Cluster ----------
aws ecs create-cluster --region "$AWS_REGION" --cluster-name "$CLUSTER" >/dev/null
echo "✓ ECS cluster: $CLUSTER"

# ---------- 2. IAM roles ----------
TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
  "Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

ensure_role() {  # $1=name
  aws iam get-role --role-name "$1" >/dev/null 2>&1 \
    || aws iam create-role --role-name "$1" --assume-role-policy-document "$TRUST" >/dev/null
}

# --- execution role: ECS AGENT dùng, TRƯỚC khi container chạy ---
ensure_role ecommerceTaskExecutionRole
aws iam attach-role-policy --role-name ecommerceTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
# AmazonECSTaskExecutionRolePolicy KHÔNG bao gồm secretsmanager → phải thêm inline,
# thiếu là task chết lúc khởi động với ResourceInitializationError (không phải lỗi app).
SECRET_ARN="$(aws secretsmanager describe-secret --region "$AWS_REGION" \
  --secret-id "$SECRET_NAME" --query ARN --output text 2>/dev/null || echo '*')"
aws iam put-role-policy --role-name ecommerceTaskExecutionRole \
  --policy-name read-app-secret \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",
    \"Action\":[\"secretsmanager:GetSecretValue\"],\"Resource\":\"${SECRET_ARN}\"}]}"
echo "✓ execution role (secret: $SECRET_ARN)"

# --- task role: CODE trong container dùng (AWS SDK → SES) ---
ensure_role ecommerceTaskRole
aws iam put-role-policy --role-name ecommerceTaskRole \
  --policy-name send-email \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
    "Action":["ses:SendEmail","ses:SendRawEmail"],"Resource":"*"}]}'
echo "✓ task role"

# ---------- 3. Cloud Map namespace ----------
# gRPC service discovery: mỗi ECS service đăng ký → auth-service.microservice.local, v.v.
NS_ID=$(aws servicediscovery list-namespaces --region "$AWS_REGION" \
  --query "Namespaces[?Name=='$NAMESPACE'].Id" --output text)
if [ -z "$NS_ID" ]; then
  echo "▸ Tạo private DNS namespace $NAMESPACE (mất ~1 phút)..."
  OP=$(aws servicediscovery create-private-dns-namespace --region "$AWS_REGION" \
        --name "$NAMESPACE" --vpc "$VPC_ID" --query OperationId --output text)
  until [ "$(aws servicediscovery get-operation --region "$AWS_REGION" \
             --operation-id "$OP" --query 'Operation.Status' --output text)" = "SUCCESS" ]; do
    sleep 5; echo "  ...đang tạo"
  done
  NS_ID=$(aws servicediscovery list-namespaces --region "$AWS_REGION" \
           --query "Namespaces[?Name=='$NAMESPACE'].Id" --output text)
fi
echo "✓ Cloud Map namespace: $NAMESPACE ($NS_ID)"

cat <<SUMMARY

✅ Xong. Lưu lại:

  export ACCOUNT_ID=$ACCOUNT_ID
  export CLUSTER=$CLUSTER
  export NS_ID=$NS_ID
  export SECRET_SUFFIX=${SECRET_ARN##*-}

Bước tiếp:
  ./infra/ecs-fargate/setup-alb.sh          # ALB + target group cho api-gateway
  ./deploy/ecs/register-taskdefs.sh          # đăng ký 5 task definition
  ./infra/ecs-fargate/create-services.sh     # tạo 5 ECS service
SUMMARY
