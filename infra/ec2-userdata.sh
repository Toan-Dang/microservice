#!/bin/bash
# EC2 user-data — dán vào ô "User data" khi tạo instance (Amazon Linux 2023).
# Tự động: cài Docker, docker compose, CodeDeploy agent, tạo swap 2GB (quan trọng cho t3.micro 1GB RAM).
set -e

# ---------- Swap 2GB (tránh out-of-memory khi chạy nhiều container) ----------
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---------- Docker ----------
dnf update -y
dnf install -y docker
systemctl enable --now docker
usermod -aG docker ec2-user

# docker compose v2 (plugin)
mkdir -p /usr/libexec/docker/cli-plugins
curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/libexec/docker/cli-plugins/docker-compose
chmod +x /usr/libexec/docker/cli-plugins/docker-compose

# ---------- AWS CLI (thường có sẵn trên AL2023) ----------
dnf install -y awscli || true

# ---------- CodeDeploy agent (cho CI/CD Route B) ----------
dnf install -y ruby wget
cd /home/ec2-user
REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)
wget "https://aws-codedeploy-${REGION}.s3.${REGION}.amazonaws.com/latest/install"
chmod +x ./install
./install auto
systemctl enable --now codedeploy-agent

# ---------- Thư mục app ----------
mkdir -p /home/ec2-user/app
chown -R ec2-user:ec2-user /home/ec2-user/app

echo "EC2 bootstrap done."
