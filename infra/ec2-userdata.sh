#!/bin/bash
# EC2 user-data — dán vào ô "User data" khi tạo instance (Amazon Linux 2023).
# Tự động: cài Docker, docker compose, CodeDeploy agent, tạo swap 2GB (quan trọng cho instance 1GB RAM).
set -e

# ---------- Swap 2GB (tránh out-of-memory khi chạy nhiều container) ----------
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---------- Instance metadata (IMDSv2) ----------
# AMI của AL2023 đặt imds-support=v2.0 → IMDSv1 BỊ TẮT, gọi thẳng 169.254.169.254 sẽ trả 401.
# Bắt buộc PUT lấy token trước, rồi kèm token vào mọi request metadata.
IMDS_TOKEN=$(curl -sf -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
REGION=$(curl -sf -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" \
  http://169.254.169.254/latest/meta-data/placement/region)

# ---------- Docker ----------
dnf update -y
dnf install -y docker
systemctl enable --now docker
usermod -aG docker ec2-user

# docker compose v2 (plugin).
# AL2023 không có gói docker-compose-plugin trong repo mặc định → tải binary từ GitHub.
# Chọn binary theo kiến trúc: t3.* là x86_64, t4g.* (Graviton) là aarch64 — hardcode x86_64 sẽ hỏng trên t4g.
case "$(uname -m)" in
  aarch64) COMPOSE_ARCH=aarch64 ;;
  *)       COMPOSE_ARCH=x86_64 ;;
esac
mkdir -p /usr/libexec/docker/cli-plugins
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${COMPOSE_ARCH}" \
  -o /usr/libexec/docker/cli-plugins/docker-compose
chmod +x /usr/libexec/docker/cli-plugins/docker-compose

# ---------- AWS CLI ----------
# AL2023 cài sẵn AWS CLI v2. Nếu thiếu thì tên gói là awscli-2 (KHÔNG phải awscli — gói đó là v1, không có trên AL2023).
command -v aws >/dev/null 2>&1 || dnf install -y awscli-2

# ---------- CodeDeploy agent (cho CI/CD Route B) ----------
# Agent 2.0.x dùng prefix latestv2/ và KHÔNG cần ruby (bản 1.8.x ở prefix latest/ mới cần).
dnf install -y wget
cd /home/ec2-user
wget "https://aws-codedeploy-${REGION}.s3.${REGION}.amazonaws.com/latestv2/install"
chmod +x ./install
./install auto
systemctl enable --now codedeploy-agent

# ---------- Thư mục app ----------
# deploy-to-ec2.sh và CodeDeploy hooks đều làm việc trong thư mục này.
mkdir -p /home/ec2-user/app/infra
chown -R ec2-user:ec2-user /home/ec2-user/app

echo "EC2 bootstrap done."
