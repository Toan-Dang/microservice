# AWS Setup — Ngày 5 (Deploy chi phí thấp nhất có thể)

> Mục tiêu: đưa hệ thống lên internet bằng **1 EC2 nhỏ**, image lưu ở **ECR**.
> Không dùng RDS/ElastiCache/MQ/Fargate — tất cả chạy container trên chính EC2 để tiết kiệm tối đa.
>
> *Kiểm chứng lại với tài liệu AWS tháng 08/2026.*

## 0. ĐỌC TRƯỚC: Free Tier đã đổi từ 15/07/2025

AWS tái cấu trúc Free Tier. **Quyền lợi phụ thuộc ngày tạo tài khoản** — đây là thay đổi
quan trọng nhất so với mọi hướng dẫn cũ trên mạng:

| | Tài khoản tạo **trước** 15/07/2025 | Tài khoản tạo **từ** 15/07/2025 |
|---|---|---|
| Instance type free-tier eligible | `t2.micro`, `t3.micro` | `t3.micro`, `t3.small`, `t4g.micro`, `t4g.small`, `c7i-flex.large`, `m7i-flex.large` |
| Hạn mức | 750 giờ/tháng miễn phí, vượt thì trả pay-as-you-go | **$100 credit** khi đăng ký + tối đa $100 credit thưởng. **Không có 750 giờ riêng** — giờ chạy trừ thẳng vào credit |
| Thời hạn | **12 tháng** từ ngày tạo tài khoản | **6 tháng**, hoặc đến khi hết credit — cái nào tới trước |
| Khi hết hạn | Chuyển sang tính tiền bình thường | Nếu vẫn ở **Free plan**: AWS **đóng tài khoản**, mất quyền truy cập tài nguyên (giữ dữ liệu 90 ngày để nâng cấp) |

**Hệ quả thực tế cho bài này:**
- Tài khoản mới ⇒ **không còn "$0 vô thời hạn"**. Ngân sách thật là $200 credit / 6 tháng.
  Chạy 1 `t3.micro` 24/7 vẫn thoải mái trong 6 tháng, nhưng phải chủ động **stop instance** khi không demo.
- Muốn giữ tài khoản sau 6 tháng thì phải **upgrade lên Paid plan** (có thể upgrade bất cứ lúc nào trong 6 tháng, credit vẫn giữ).
- $100 credit thưởng chia theo 5 nhiệm vụ onboarding ($20/nhiệm vụ) — một trong số đó là
  **tạo budget trong AWS Budgets**, tức là làm bước 0 bên dưới vừa an toàn vừa được credit.

Kiểm tra chính xác instance type nào đang free-tier eligible **cho tài khoản của bạn**:
```bash
aws ec2 describe-instance-types \
  --filters Name=free-tier-eligible,Values=true \
  --query "InstanceTypes[*].[InstanceType]" --output text | sort
```

> ⚠️ `t4g.micro`/`t4g.small` là **Graviton (arm64)**. Nếu chọn t4g thì image Docker phải build cho
> `linux/arm64` (`docker buildx build --platform linux/arm64`), không dùng được image x86 build sẵn.
> Hướng dẫn này mặc định **t3.micro (x86_64)** để khỏi phải đụng tới buildx.

## 1. Chặn hoá đơn bất ngờ (làm ĐẦU TIÊN)
- **AWS Budgets** → tạo budget $1/tháng, bật email alert. Miễn phí, và với tài khoản mới còn được $20 credit.
- Tài khoản **trước** 15/07/2025: Billing preferences → bật "Receive Free Tier Usage Alerts".
- Tài khoản **từ** 15/07/2025: theo dõi số credit còn lại ở **Billing and Cost Management → Free Tier**.

## 2. Tạo ECR repositories
Console → ECR → tạo 5 private repo:
`api-gateway`, `auth-service`, `product-service`, `order-service`, `notification-worker`.
Hoặc CLI:
```bash
for s in api-gateway auth-service product-service order-service notification-worker; do
  aws ecr create-repository --repository-name $s --region ap-southeast-1
done
```
- Free tier: **500 MB/tháng** lưu trữ private repo trong 12 tháng đầu.
- Đặt **lifecycle policy** giữ tối đa ~3 image mỗi repo.
- Từ **01/2026**, ECR dedupe layer **trên toàn registry** (trước đó chỉ dedupe trong từng repo).
  5 service ở đây dùng chung base `node:24-alpine` ⇒ layer base chỉ tốn dung lượng **1 lần** cho cả 5 repo.
  Tự động, không cần đổi cách build.

## 3. Tạo IAM role cho EC2 (instance profile)
Role cho EC2 gắn 2 policy:
- `AmazonEC2ContainerRegistryReadOnly` — để pull image từ ECR.
- (nếu dùng CodeDeploy) quyền đọc S3 artifact — thêm `AmazonS3ReadOnlyAccess` hoặc scoped hơn.

## 4. Tạo EC2
- AMI: **Amazon Linux 2023**.
- Type: **t3.micro** (xem bảng free tier ở mục 0 để chắc tài khoản bạn được loại nào).
- Key pair: tạo mới, tải file `.pem` (dùng cho SSH & GitHub Actions deploy).
- **IAM instance profile**: chọn role ở bước 3.
- **User data**: dán toàn bộ nội dung `infra/ec2-userdata.sh`.
- Storage: 20 GB gp3.
- **Tag**: `Name=ecommerce-prod` (CodeDeploy dùng tag này).

> AMI AL2023 bật **IMDSv2-only** mặc định (`imds-support=v2.0`). Mọi script đọc instance metadata
> phải `PUT` lấy token trước — `ec2-userdata.sh` đã làm đúng. Script cũ gọi thẳng
> `curl http://169.254.169.254/...` sẽ nhận **401** và fail âm thầm.

### Security Group
| Port | Nguồn | Mục đích |
|---|---|---|
| 22 (SSH) | **Chỉ IP của bạn** | quản trị |
| 80 (HTTP) | 0.0.0.0/0 | api-gateway public |

> KHÔNG mở 5432/6379/5672/15672 ra ngoài — các cổng này chỉ dùng nội bộ giữa container.

## 5. Deploy tay lần đầu (để kiểm chứng trước khi bật CI/CD)

Dùng `infra/deploy-to-ec2.sh` — script tự copy config lên EC2 rồi login ECR & up stack:

```bash
# .env local phải có POSTGRES_PASSWORD, JWT_SECRET, ECR_REGISTRY, AWS_REGION
cp .env.example .env && nano .env

EC2_IP=<EC2_IP> EC2_SSH_KEY=~/.ssh/key.pem ./infra/deploy-to-ec2.sh
```

Script làm 3 việc:
1. `scp` `docker-compose.prod.yml` → `~/app/`, `.env` → `~/app/.env` (chmod 600),
   `infra/init-multiple-dbs.sh` → `~/app/infra/` (đúng đường dẫn compose bind-mount).
2. SSH chạy `aws ecr get-login-password | docker login` → `compose pull` → `compose up -d` → `image prune`.
   EC2 dùng **IAM instance profile** nên không cần đặt AWS key trên host.
3. Poll `http://<EC2_IP>/health` tối đa 60s, fail thì in luôn lệnh xem log.

Tham số đọc từ env (thứ tự ưu tiên: env > `.env` > mặc định): `EC2_IP`, `EC2_SSH_KEY` (bắt buộc),
`EC2_USER`, `APP_DIR`, `ENV_FILE`, `ECR_REGISTRY`, `AWS_REGION`, `TAG`.

```bash
# deploy 1 tag cụ thể thay vì latest
EC2_IP=<EC2_IP> EC2_SSH_KEY=~/.ssh/key.pem TAG=abc1234 ./infra/deploy-to-ec2.sh
```

> `.env` chứa secret nên **không qua git** — script copy thẳng từ máy bạn lên EC2.
> Khi bật CI/CD (Route B), CodeDeploy hooks ở `cicd/aws/scripts/` lo phần này, không dùng script trên.

### Seed dữ liệu trên prod
`docker-compose.prod.yml` **không** set `SEED_ON_BOOT` (đúng chủ ý — prod không tự seed), nên
`product_db` sẽ rỗng sau lần deploy đầu và `GET /products` trả mảng rỗng. Muốn có dữ liệu demo:

```bash
docker compose -f docker-compose.prod.yml exec product-service npm run seed:prod
docker compose -f docker-compose.prod.yml exec auth-service    npm run seed:prod
```

Phải dùng `seed:prod` (chạy `node dist/database/seeds/run-seed.js`), **không** dùng `npm run seed` —
script đó gọi `ts-node` trên `src/`, mà image production đã `npm prune --production` và không copy `src/`.
Seeder idempotent theo key nghiệp vụ nên chạy lại nhiều lần vô hại.

## 6. Tối ưu RAM (t3.micro chỉ 1GB)
- Swap 2GB đã bật sẵn (trong user-data).
- `mem_limit` từng container đã đặt trong `docker-compose.prod.yml`.
- Theo dõi: `docker stats`. Nếu OOM-kill → cân nhắc gộp worker, hoặc tạm dùng `t3.small`
  (với tài khoản tạo từ 15/07/2025 thì t3.small **cũng free-tier eligible**, chỉ tốn credit nhanh hơn).

## 7. Khi làm xong / không demo nữa (TIẾT KIỆM TIỀN)
- **Stop instance** (không terminate nếu còn muốn dùng lại) → chỉ tính EBS ~vài cent/ngày.
  Với tài khoản mới, stop = ngừng đốt credit — việc này quan trọng hơn hẳn so với thời 750h/tháng.
- Hoặc **terminate** + xóa ECR image nếu xong hẳn.
- Xoá CodePipeline nếu không giữ (tránh $1/tháng).
- Tài khoản Free plan sắp hết 6 tháng: quyết định **upgrade lên Paid** hay chấp nhận bị đóng tài khoản.
  Nếu muốn giữ repo demo sống, upgrade rồi stop hết tài nguyên là rẻ nhất.
