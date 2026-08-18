# 01 — Networking (VPC + Security Group)

Dùng cho **cả ECS Fargate và EKS**. Dựng 1 lần.

## VPC

Dùng **default VPC** của `us-east-1` — đã có public subnet ở nhiều AZ, không phải tự dựng.
Lấy id để dùng cho các bước sau:

```bash
export AWS_REGION=us-east-1
export VPC_ID=$(aws ec2 describe-vpcs --region $AWS_REGION \
  --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
export SUBNET_IDS=$(aws ec2 describe-subnets --region $AWS_REGION \
  --filters Name=vpc-id,Values=$VPC_ID --query 'Subnets[].SubnetId' --output text)
echo "VPC=$VPC_ID  SUBNETS=$SUBNET_IDS"
```

## 3 security group

| SG | Inbound | Nguồn | Dùng cho |
|---|---|---|---|
| `sg-alb` | 80 (+443 nếu có cert) | `0.0.0.0/0` | ALB (bậc 1) / ALB do Ingress Controller tạo (bậc 2) |
| `sg-app` | 3000 | `sg-alb` | api-gateway nhận REST từ ALB |
| `sg-app` | 50051–50053 | **chính `sg-app`** | gRPC giữa các task/pod |
| `sg-data` | 5432, 6379, 5671 | **chỉ `sg-app`** | RDS / ElastiCache / Amazon MQ |

Tạo bằng script (idempotent, chạy lại được):

```bash
./infra/common/setup-network.sh
```

Script in ra 3 SG id — lưu lại, mọi bước sau đều cần.

## Quyết định đơn giản hoá: public subnet, KHÔNG NAT Gateway

Fargate task (và EKS node) đặt ở **public subnet + assign public IP** để kéo image từ ECR mà
không cần NAT Gateway. NAT ~$1/ngày + phí data — cắt được cho learning.

> **Chuẩn production** là private subnet + NAT Gateway, hoặc VPC endpoint cho ECR/S3/CloudWatch Logs.
> Ghi lại như **hardening step** (Ngày 12–13), không làm Ngày 1.
> Đây là câu trả lời phỏng vấn tốt: biết đường chuẩn, và biết vì sao mình cố ý không đi.

## Failure mode

- **Task/pod stuck `PENDING` → `STOPPED` với `CannotPullContainerError`**: thiếu public IP ở public
  subnet (hoặc thiếu NAT ở private subnet) → không ra được ECR.
- **gateway timeout `DEADLINE_EXCEEDED` → HTTP 504**: `sg-app` chưa mở 50051–50053 cho **chính nó**.
  Rất dễ sót vì nguồn không phải CIDR mà là *security group id của chính SG đó*.
- **RDS `connection timeout`**: `sg-data` mở cho CIDR của subnet thay vì cho `sg-app` → sai khi
  task nhảy sang AZ khác.

## Riêng cho EKS (bậc 2)

`eksctl` tự tạo SG cho node group và control plane. Bạn **không** thay `sg-app` bằng SG đó —
thay vào đó **gắn thêm** `sg-data` cho phép inbound từ SG của node group:

```bash
# NODE_SG lấy từ: eksctl get cluster ecommerce -o json | jq -r '...' hoặc EC2 console
aws ec2 authorize-security-group-ingress --region $AWS_REGION \
  --group-id $SG_DATA --protocol tcp --port 5432 --source-group $NODE_SG
```

Chi tiết ở [`../eks/README.md`](../eks/README.md) §3.
