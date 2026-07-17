#!/bin/bash
# CodeDeploy hook: ApplicationStop — dừng stack cũ (nếu có).
set -e
APP_DIR=/home/ec2-user/app
if [ -f "$APP_DIR/docker-compose.prod.yml" ]; then
  cd "$APP_DIR"
  docker compose -f docker-compose.prod.yml down || true
fi
