# Console Guide — Hạ tầng dùng chung (Ngày 1)

> **Bản bấm chuột.** Bản CLI tương ứng: [`setup-network.sh`](./setup-network.sh),
> [`setup-stateful.sh`](./setup-stateful.sh) — dùng khi bạn đã hiểu và muốn dựng lại nhanh.
>
> **Trạng thái đối chiếu (18/08/2026).** Console UI đổi thường xuyên hơn API, nên đây là phần dễ lệch nhất.
> ✅ *đã đối chiếu với trang "AWS Management Console" trong docs AWS* · ⚠️ *chưa đối chiếu lại lần này —
> tên nút có thể khác đôi chút, ý nghĩa thì không đổi.*
>
> | Bước | Trạng thái |
> |---|---|
> | Budget, Security group, ECR, RDS, Amazon MQ, Secrets Manager | ⚠️ chưa đối chiếu lại |
> | ElastiCache (Valkey) | ⚠️ chưa đối chiếu lại — Console có mục **Valkey caches** riêng, xem kỹ nhãn engine |
>
> Nếu nhãn trên màn hình khác ở đây: **giá trị cần điền vẫn đúng**, chỉ tên/vị trí ô đổi. Bản CLI
> (`setup-network.sh`, `setup-stateful.sh`) không phụ thuộc UI nên luôn chạy được.

> Region: **us-east-1**. Kiểm tra góc trên bên phải Console luôn hiển thị **N. Virginia**
> trước mỗi bước — tạo nhầm region là lỗi phổ biến nhất của người mới, và tài nguyên
> ở region khác thì **không nhìn thấy nhau**.

---

## Bước 0 — Đặt cảnh báo chi phí TRƯỚC KHI tạo bất cứ thứ gì

**Console → Billing and Cost Management → Budgets → Create budget**

| Trường | Điền |
|---|---|
| Budget type | `Cost budget - Recommended` |
| Budget name | `ecommerce-15d` |
| Period | `Monthly` |
| Budget amount | `150` (dưới trần $190 để còn kịp phản ứng) |
| Alert threshold | `80% of budgeted amount` |
| Email recipients | email của bạn |

Xem credit còn lại: **Billing → Free Tier** (hoặc **Credits**).

---

## Bước 1 — Security group (3 cái)

**Console → EC2 → Network & Security → Security Groups → Create security group**

Làm đúng thứ tự dưới đây: `sg-app` cần tham chiếu `sg-alb`, `sg-data` cần `sg-app`.

### 1a. `ecommerce-sg-alb`

| Trường | Giá trị |
|---|---|
| Security group name | `ecommerce-sg-alb` |
| Description | `ALB public ingress` |
| VPC | chọn VPC có nhãn **(default)** |

Inbound rules → **Add rule** ×2:

| Type | Port | Source |
|---|---|---|
| HTTP | 80 | `Anywhere-IPv4` (0.0.0.0/0) |
| HTTPS | 443 | `Anywhere-IPv4` |

Outbound: để nguyên (All traffic). **Create security group** → ghi lại id `sg-xxxxxxxx`.

### 1b. `ecommerce-sg-app`

Tạo tương tự, rồi Inbound:

| Type | Port | Source | Ý nghĩa |
|---|---|---|---|
| Custom TCP | 3000 | chọn **Custom** → gõ `sg-` → chọn `ecommerce-sg-alb` | ALB → gateway |
| Custom TCP | 50051 | **chính `ecommerce-sg-app`** | gRPC nội bộ |
| Custom TCP | 50052 | chính `ecommerce-sg-app` | gRPC nội bộ |
| Custom TCP | 50053 | chính `ecommerce-sg-app` | gRPC nội bộ |

> ⚠️ 3 rule gRPC có **nguồn là chính security group này**, không phải một dải IP.
> Lúc tạo SG lần đầu chưa có id nên chưa chọn được chính nó → **Create** trước với mỗi rule 3000,
> rồi mở lại SG vừa tạo → **Edit inbound rules** → thêm 3 rule gRPC (giờ đã chọn được chính nó).
> Quên bước này = api-gateway gọi service khác bị timeout, trả HTTP 504.

### 1c. `ecommerce-sg-data`

| Type | Port | Source |
|---|---|---|
| PostgreSQL | 5432 | `ecommerce-sg-app` |
| Custom TCP | 6379 | `ecommerce-sg-app` |
| Custom TCP | 5671 | `ecommerce-sg-app` |

> 5671 là **AMQPS (TLS)** của Amazon MQ — không phải 5672 như RabbitMQ local.

**Ghi lại 3 id vào giấy nhớ** — mọi bước sau đều cần:

```
sg-alb  = sg-________
sg-app  = sg-________
sg-data = sg-________
```

---

## Bước 2 — ECR (5 repository)

**Console → Elastic Container Registry → Repositories → Create repository**

Lặp 5 lần, mỗi lần đổi tên: `api-gateway`, `auth-service`, `product-service`, `order-service`,
`notification-worker`.

| Trường | Giá trị |
|---|---|
| Visibility | **Private** |
| Repository name | tên service |
| Image scan on push | bật (miễn phí, quét CVE cơ bản) |

Sau khi tạo, mở 1 repo → nút **View push commands** (góc trên phải) → Console tự in ra 4 lệnh
`docker login / build / tag / push` **đã điền sẵn account id của bạn**. Rất tiện để đối chiếu.

> ⚠️ **Push image thì bắt buộc phải dùng terminal** — Console không upload image được.
> Đây là chỗ duy nhất ở Ngày 1 không tránh được CLI. Dùng [`../../deploy/push-ecr.sh`](../../deploy/push-ecr.sh)
> (nó thêm sẵn `--platform linux/amd64` và `--target production`, hai thứ mà "push commands"
> của Console **không** có — thiếu là task chết với `exec format error`).

Lifecycle policy (giữ ECR gần như free): mở repo → tab **Lifecycle Policy** → **Create rule**
→ Rule priority `1`, Image status `Any`, Match criteria **Image count more than** `5`, action `Expire`.

---

## Bước 3 — RDS Postgres

**Console → RDS → Databases → Create database**

| Trường | Chọn | Vì sao |
|---|---|---|
| Choose a database creation method | **Standard create** | Easy create giấu mất phần security group |
| Engine type | **PostgreSQL** | |
| Engine version | **16.x** | khớp `postgres:16-alpine` ở local; RDS còn standard support tới 11/2028 |
| Templates | **Free tier** *(nếu có)*, không thì **Dev/Test** | |
| DB instance identifier | `ecommerce-pg` | |
| Master username | `postgres` | |
| Credentials management | **Self managed** → nhập password | *Managed in Secrets Manager* tạo secret riêng, sẽ lệch với secret ta tự tạo ở bước 5 |
| Instance configuration | **db.t3.micro** (Burstable) | |
| Storage type / size | **gp3**, `20 GiB` | |
| Storage autoscaling | **tắt** | tránh phình dung lượng ngoài ý muốn |
| Availability | **Single-AZ** | Multi-AZ đắt gấp đôi, không học thêm gì ở phase này |
| **Connectivity → Public access** | **Yes** | để chạy `psql` tạo 3 database và chạy migration từ máy bạn |
| VPC security group | **Choose existing** → `ecommerce-sg-data`, **bỏ** `default` | |
| Additional configuration → Backup retention | `0 days` | snapshot tự động tốn tiền, dự án học không cần |
| Deletion protection | **tắt** | bật thì lúc teardown phải sửa lại mới xoá được |

**Create database** → mất ~5–10 phút để `Available`.

> "Public access = Yes" **không** có nghĩa mở cho cả internet — security group vẫn chặn.
> Nó chỉ cấp cho instance một public DNS name để bạn kết nối được từ ngoài VPC.

### 3b. Tạo 3 database bên trong

Mở `ecommerce-pg` → tab **Connectivity & security** → copy **Endpoint**.

Tạm mở đường cho máy bạn: **EC2 → Security Groups → `ecommerce-sg-data` → Edit inbound rules**
→ Add rule: PostgreSQL / 5432 / Source **My IP** → Save.

Rồi ở terminal:

```bash
psql -h <endpoint> -U postgres -d postgres
CREATE DATABASE auth_db;
CREATE DATABASE product_db;
CREATE DATABASE order_db;
\l
\q
```

**Xoá rule "My IP" ngay sau khi xong.**

> Không có `psql`? Cách thuần Console: **RDS → Query Editor** chỉ hỗ trợ Aurora, **không** dùng
> được với RDS Postgres thường. Thay thế: cài `postgresql-client`, hoặc dùng pgAdmin/DBeaver
> trên máy — vẫn phải mở rule My IP như trên.

---

## Bước 4 — ElastiCache **Valkey** (không phải Redis OSS)

**Console → ElastiCache → Valkey caches → Create Valkey cache**

| Trường | Chọn |
|---|---|
| Deployment option | **Design your own cache** |
| Creation method | **Cluster cache** (không phải Serverless — Serverless đắt hơn nhiều cho tải nhỏ) |
| Cluster mode | **Disabled** |
| Name | `ecommerce-redis` |
| Engine version | mới nhất Console gợi ý (8.x/9.x) |
| Node type | **cache.t3.micro** |
| Number of replicas | **0** |
| Multi-AZ | tắt |
| Subnet group | Create new → chọn default VPC + ≥2 subnet |
| Security group | `ecommerce-sg-data` |
| **Encryption in transit** | **tắt** |
| Backup | tắt |

> **Vì sao Valkey chứ không phải "Redis"** (Console có cả hai mục): Valkey **rẻ hơn 20%** cho
> node-based cluster và **wire-compatible hoàn toàn** — `ioredis` giữ nguyên, URL vẫn `redis://`,
> **không sửa dòng code nào**. Trên ElastiCache, Redis OSS dừng ở 7.1; Valkey là nhánh đang được
> phát triển tiếp. (Bối cảnh: Redis đổi license năm 2024 → Linux Foundation fork thành Valkey,
> AWS chuyển sang đẩy Valkey. Biết chuyện này là điểm cộng phỏng vấn.)
>
> Tắt encryption in-transit cũng là **có chủ đích**: giữ URL `redis://...:6379` giống hệt local
> (bật lên thì `ioredis` cần thêm option `tls: {}` — sửa code).

Lấy endpoint: mở cache → **Primary endpoint** (bỏ phần `:6379` khi điền vào biến `REDIS_HOST`).

---

## Bước 5 — Amazon MQ (RabbitMQ)

**Console → Amazon MQ → Create brokers**

| Trường | Chọn |
|---|---|
| Broker engine type | **RabbitMQ** |
| Engine version | **4.2** (bản AWS khuyến nghị; 3.13 vẫn còn hỗ trợ) |
| Deployment mode | **Single-instance broker** |
| Broker name | `ecommerce-mq` |
| Broker instance type | **mq.t3.micro** |
| Username | `ecommerce` |
| Password | **≥12 ký tự**, không khoảng trắng, không dấu phẩy |
| Access type | **Public access** *(đơn giản cho learning)* |
| Security group | `ecommerce-sg-data` |

Mất ~10–15 phút. Xong → mở broker → **Connections** → copy endpoint dạng
`amqps://b-xxxx-xxxx.mq.us-east-1.amazonaws.com:5671`.

> ⚠️ **`amqps://` và cổng 5671**, không phải `amqp://:5672` như local. Sai là `ECONNREFUSED`
> hoặc handshake fail, mà log của NestJS RMQ transport rất khó đọc.
>
> ℹ️ Local `docker-compose` chạy RabbitMQ 3.13, broker này là 4.2 — lệch minor là chấp nhận được.
> Thay đổi 4.x đáng biết: **bỏ global QoS** (`basic.qos` với `global=true`). Code ở đây dùng
> `channel.prefetch(10)` (per-consumer, `amqplib` mặc định `global=false`) nên không bị ảnh hưởng.

---

## Bước 6 — Secrets Manager

**Console → Secrets Manager → Store a new secret**

| Trường | Chọn |
|---|---|
| Secret type | **Other type of secret** |
| Key/value pairs | dùng tab **Plaintext**, dán JSON bên dưới |
| Encryption key | `aws/secretsmanager` (mặc định) |
| Secret name | `ecommerce/app` |
| Rotation | tắt |

```json
{
  "JWT_SECRET": "<chuỗi ngẫu nhiên 64 ký tự hex>",
  "AUTH_DATABASE_URL":    "postgres://postgres:<pass>@<rds-endpoint>:5432/auth_db?sslmode=no-verify",
  "PRODUCT_DATABASE_URL": "postgres://postgres:<pass>@<rds-endpoint>:5432/product_db?sslmode=no-verify",
  "ORDER_DATABASE_URL":   "postgres://postgres:<pass>@<rds-endpoint>:5432/order_db?sslmode=no-verify",
  "RABBITMQ_URL":         "amqps://ecommerce:<mq-pass>@<broker>.mq.us-east-1.amazonaws.com:5671"
}
```

Sinh `JWT_SECRET`: `openssl rand -hex 32`.

**Vì sao lưu URL hoàn chỉnh thay vì user/pass rời:** ECS task definition **không nội suy biến** —
viết `${POSTGRES_PASSWORD}` trong ô environment thì nó là chuỗi ký tự literal, không phải template.
Nên phải ghép sẵn 1 lần ở đây. Bậc 2 (EKS) dùng lại đúng bộ key này.

**⚠️ `?sslmode=no-verify` là bắt buộc** — RDS force SSL. Thiếu là app chết với
`no pg_hba.conf entry for host ... SSL off`.

Sau khi tạo, mở secret → copy **Secret ARN**. Đuôi có 6 ký tự ngẫu nhiên:
`arn:aws:secretsmanager:us-east-1:123456789012:secret:ecommerce/app-**AbCdEf**` →
**ghi lại 6 ký tự đó**, ECS task definition cần.

---

## ✅ Checklist cuối Ngày 1

- [ ] Budget $150 đã có, email alert đã nhận được mail xác nhận
- [ ] 3 security group, `sg-app` có đủ 3 rule gRPC trỏ về chính nó
- [ ] 5 repo ECR, mỗi repo có ít nhất 1 image (**ECR → repo → Images**)
- [ ] RDS `Available`, `\l` thấy `auth_db` / `product_db` / `order_db`
- [ ] ElastiCache **Valkey** `Available`, đã copy Primary endpoint
- [ ] Amazon MQ `Running` (RabbitMQ 4.2), endpoint là `amqps://...:5671`
- [ ] Secret `ecommerce/app` có 5 key, đã ghi lại 6 ký tự đuôi ARN
- [ ] Rule "My IP" trên `sg-data` **đã xoá**

Tiếp: [`../ecs-fargate/CONSOLE_GUIDE.md`](../ecs-fargate/CONSOLE_GUIDE.md)

---

## 💸 Trước khi tắt máy

**RDS → Databases → chọn `ecommerce-pg` → Actions → Stop temporarily.**
AWS tự start lại sau 7 ngày (không tắt vĩnh viễn được) — nhớ vào stop lại.
ElastiCache và Amazon MQ **không stop được**, chỉ xoá; giữ hay xoá tuỳ bạn, xem
[`COST_PLAN.md`](./COST_PLAN.md).
