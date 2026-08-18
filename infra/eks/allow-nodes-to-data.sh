#!/usr/bin/env bash
#
# allow-nodes-to-data.sh — Bậc 2, Ngày 5 bước 3: cho phép node group EKS vào sg-data.
# Chạy từ ROOT repo:  SG_DATA=sg-xxx ./infra/eks/allow-nodes-to-data.sh
#
# VÌ SAO CẦN: sg-data (dựng ở bậc 1) chỉ mở cho sg-app — SG của Fargate task.
# Node group EKS do eksctl tạo có SG RIÊNG, không nằm trong rule đó → pod nối RDS/Redis/MQ
# sẽ timeout (không phải "refused", nên rất dễ nhầm là sai endpoint).
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
CLUSTER="${CLUSTER:-ecommerce}"

fail() { echo "✗ $*" >&2; exit 1; }
[ -n "${SG_DATA:-}" ] || fail "Thiếu SG_DATA"

# SG dùng chung của cluster (eksctl gắn cho cả node group) — đây là cái cần cấp quyền.
NODE_SG=$(aws eks describe-cluster --region "$AWS_REGION" --name "$CLUSTER" \
  --query 'cluster.resourcesVpcConfig.clusterSecurityGroupId' --output text)
[ "$NODE_SG" != "None" ] || fail "Không lấy được cluster security group của $CLUSTER"

echo "▸ Cluster SG: $NODE_SG  →  sg-data: $SG_DATA"

for port in 5432 6379 5671; do
  aws ec2 authorize-security-group-ingress --region "$AWS_REGION" \
    --group-id "$SG_DATA" --protocol tcp --port "$port" --source-group "$NODE_SG" >/dev/null 2>&1 \
    && echo "  ✓ mở $port" \
    || echo "  (đã có) $port"
done

cat <<SUMMARY

✅ Xong. Kiểm chứng từ trong cluster (pod tạm, xoá ngay sau khi thoát):

  kubectl run netcheck --rm -it --image=busybox --restart=Never -- \\
    sh -c 'nc -zv <rds-endpoint> 5432; nc -zv <redis-endpoint> 6379'

Timeout = SG chưa thông. "refused" = SG thông nhưng service chưa chạy.
SUMMARY
