#!/bin/bash
# CodeDeploy hook: ApplicationStart — khởi động stack + health check.
set -e
APP_DIR=/home/ec2-user/app
cd "$APP_DIR"

if [ -f deploy.env ]; then
  set -a; source deploy.env; set +a
fi

# .env chứa secret (POSTGRES_PASSWORD, JWT_SECRET...) được đặt sẵn trên EC2, KHÔNG qua git.
docker compose -f docker-compose.prod.yml up -d
docker image prune -f

# Health check đơn giản
sleep 10
curl -fsS http://localhost:80/health || (echo "Health check FAILED" && exit 1)
echo "Deploy OK"
