# AWS Setup — Ngày 5 (Deploy chi phí ~$0)

> Mục tiêu: đưa hệ thống lên internet bằng **1 EC2 t3.micro free tier**, image lưu ở **ECR**.
> Không dùng RDS/ElastiCache/MQ/Fargate — tất cả chạy container trên chính EC2 để tiết kiệm tối đa.

## 0. Chặn hoá đơn bất ngờ (làm ĐẦU TIÊN)
- **AWS Budgets** → tạo budget $1/tháng, bật email alert. Miễn phí.
- **Billing preferences** → bật "Receive Free Tier Usage Alerts".

## 1. Tạo ECR repositories
Console → ECR → tạo 5 private repo:
`api-gateway`, `auth-service`, `product-service`, `order-service`, `notification-worker`.
Hoặc CLI:
```bash
for s in api-gateway auth-service product-service order-service notification-worker; do
  aws ecr create-repository --repository-name $s --region ap-southeast-1
done
```
> Tiết kiệm: đặt **lifecycle policy** giữ tối đa ~3 image mỗi repo (ECR free 500MB).

## 2. Tạo IAM role cho EC2 (instance profile)
Role cho EC2 gắn 2 policy:
- `AmazonEC2ContainerRegistryReadOnly` — để pull image từ ECR.
- (nếu dùng CodeDeploy) quyền đọc S3 artifact — thêm `AmazonS3ReadOnlyAccess` hoặc scoped hơn.

## 3. Tạo EC2 t3.micro
- AMI: **Amazon Linux 2023**.
- Type: **t3.micro** (free tier 750h/tháng).
- Key pair: tạo mới, tải file `.pem` (dùng cho SSH & GitHub Actions deploy).
- **IAM instance profile**: chọn role ở bước 2.
- **User data**: dán toàn bộ nội dung `infra/ec2-userdata.sh`.
- Storage: 20 GB gp3 (free tier tới 30GB).
- **Tag**: `Name=ecommerce-prod` (CodeDeploy dùng tag này).

### Security Group
| Port | Nguồn | Mục đích |
|---|---|---|
| 22 (SSH) | **Chỉ IP của bạn** | quản trị |
| 80 (HTTP) | 0.0.0.0/0 | api-gateway public |

> KHÔNG mở 5432/6379/5672/15672 ra ngoài — các cổng này chỉ dùng nội bộ giữa container.

## 4. Đưa cấu hình lên EC2
SSH vào rồi tạo `.env` (chứa secret, KHÔNG qua git):
```bash
ssh -i key.pem ec2-user@<EC2_IP>
cd ~/app
# tạo .env với POSTGRES_PASSWORD, JWT_SECRET, ECR_REGISTRY, AWS_REGION...
nano .env
```
Copy `docker-compose.prod.yml` và `infra/init-multiple-dbs.sh` lên (scp hoặc để CI/CD lo).

## 5. Deploy tay lần đầu (để kiểm chứng trước khi bật CI/CD)
```bash
aws ecr get-login-password --region ap-southeast-1 \
  | docker login --username AWS --password-stdin <account>.dkr.ecr.ap-southeast-1.amazonaws.com
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
curl http://localhost/health
```
Từ máy bạn: mở `http://<EC2_IP>/health`.

## 6. Tối ưu RAM (t3.micro chỉ 1GB)
- Swap 2GB đã bật sẵn (trong user-data).
- `mem_limit` từng container đã đặt trong `docker-compose.prod.yml`.
- Theo dõi: `docker stats`. Nếu OOM-kill → cân nhắc gộp worker, hoặc tạm dùng t3.small trong lúc demo.

## 7. Khi làm xong / không demo nữa (TIẾT KIỆM TIỀN)
- **Stop instance** (không terminate nếu còn muốn dùng lại) → chỉ tính EBS ~vài cent/ngày.
- Hoặc **terminate** + xóa ECR image nếu xong hẳn.
- Xoá CodePipeline nếu không giữ (tránh $1/tháng).
