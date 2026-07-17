#!/bin/bash
# CodeDeploy hook: AfterInstall — đăng nhập ECR & pull image mới.
set -e
APP_DIR=/home/ec2-user/app
cd "$APP_DIR"

# nạp ECR_REGISTRY, TAG từ deploy.env (do buildspec sinh ra)
if [ -f deploy.env ]; then
  set -a; source deploy.env; set +a
fi

AWS_REGION=${AWS_REGION:-ap-southeast-1}

# EC2 đã gắn IAM role có quyền đọc ECR
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

docker compose -f docker-compose.prod.yml pull
