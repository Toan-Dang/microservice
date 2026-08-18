# 03 — Stateful managed (RDS · ElastiCache · Amazon MQ)

Dựng 1 lần ở Ngày 1, **dùng chung cho cả bậc 1 (ECS) và bậc 2 (EKS)**.
Khi chuyển sang EKS bạn chỉ đổi endpoint trong `ConfigMap`/`Secret` — không provision lại gì.

```bash
./infra/common/setup-stateful.sh      # tạo cả 3, in ra endpoint
```

Script chỉ *tạo*; 3 dịch vụ mất 5–15 phút để `available`. Chạy song song với `./deploy/push-ecr.sh`.

---

## 1. RDS Postgres — `db.t3.micro`, engine 16

> Chọn **PostgreSQL 16** là có chủ đích: khớp đúng `postgres:16-alpine` ở `docker-compose`, nên
> migration/seed chạy local thế nào thì trên RDS thế đó. RDS for PostgreSQL 16 còn **standard
> support tới 11/2028** — không có rủi ro bị ép nâng cấp giữa dự án.

**1 instance, 3 database** (`auth_db`, `product_db`, `order_db`). Vẫn đúng database-per-service:
mỗi service chỉ có credential/URL của database mình, không query chéo. 1 instance là để tiết kiệm,
không phải để chia sẻ schema.

Tạo 3 database sau khi instance `available` (tạm mở `sg-data` cho IP của bạn):

```bash
MYIP=$(curl -s https://checkip.amazonaws.com)/32
aws ec2 authorize-security-group-ingress --region us-east-1 \
  --group-id $SG_DATA --protocol tcp --port 5432 --cidr $MYIP

for db in auth_db product_db order_db; do
  PGPASSWORD=$POSTGRES_PASSWORD psql -h $RDS_HOST -U $POSTGRES_USER -d postgres \
    -c "CREATE DATABASE $db"
done

# ĐÓNG lại ngay sau khi xong
aws ec2 revoke-security-group-ingress --region us-east-1 \
  --group-id $SG_DATA --protocol tcp --port 5432 --cidr $MYIP
```

### ⚠️ RDS bắt SSL

Postgres RDS force SSL. `src/database/data-source.ts` và `app.module.ts` **không** cấu hình `ssl`,
nên phải đưa vào connection string — `pg` hiểu `sslmode` trong URL:

```
postgres://user:pass@<rds-endpoint>:5432/auth_db?sslmode=no-verify
```

Thiếu → `no pg_hba.conf entry for host ... SSL off` hoặc `connection terminated`.

> `sslmode=no-verify` = **có mã hoá, không verify CA** — chấp nhận được cho learning, không phải
> production-grade. Đường chuẩn là tải `rds-ca-rsa2048-g1.pem` và `sslmode=verify-full`.
> Biết sự khác nhau này là một câu trả lời phỏng vấn tốt.

---

## 2. ElastiCache **Valkey** — `cache.t3.micro`, single node

Dùng cho refresh token của auth-service + cache.

### Vì sao Valkey chứ không phải "Redis"

**Valkey rẻ hơn 20%** cho node-based cluster và **wire-compatible hoàn toàn** với Redis:
`ioredis` giữ nguyên, URL vẫn là `redis://<endpoint>:6379`, **không sửa một dòng code nào**.
Trên ElastiCache, Redis OSS dừng ở **7.1** (Redis OSS v6 hết standard support 31/01/2027),
còn Valkey là nhánh đang được phát triển tiếp (hiện tới 9.x).

Chọn "cache rẻ hơn 20% mà không phải đổi code" là loại quyết định rất đáng kể trong phỏng vấn —
và biết *vì sao* có 2 engine (Redis đổi license 2024 → AWS/Linux Foundation fork thành Valkey)
thì càng tốt.

```bash
aws elasticache describe-cache-engine-versions --engine valkey \
  --query 'CacheEngineVersions[].EngineVersion' --output text     # xem version khả dụng
```

> ⚠️ **Tài liệu AWS đang mâu thuẫn với chính nó ở chỗ này.** Mô tả API `CreateCacheCluster` viết
> *"either Memcached, Valkey or Redis OSS"*, nhưng bảng tham số `Engine` ngay bên dưới vẫn chỉ liệt kê
> `memcached | redis`. Vì vậy `setup-stateful.sh` **dò** bằng `describe-cache-engine-versions`
> trước, và tự quay về `redis 7.1` nếu region/CLI chưa nhận `valkey` (kèm cảnh báo là đang trả
> đắt hơn ~20%). Console thì rõ ràng — có hẳn mục **Valkey caches** riêng.
>
> Nếu bị fallback: nâng AWS CLI lên bản mới (`aws --version`) rồi tạo lại.

**Tắt in-transit encryption** cho đơn giản → URL là `redis://`, không phải `rediss://`.

> Bật encryption in-transit thì `ioredis` cần `tls: {}` trong option — thay đổi code, để dành hardening.

---

## 3. Amazon MQ — engine RabbitMQ **4.2**, `mq.t3.micro`, single-instance

AWS khuyến nghị **RabbitMQ 4.2** (3.13 vẫn được hỗ trợ; 3.12 đã hết hạn 17/03/2025).
Local `docker-compose` đang dùng `rabbitmq:3.13-alpine` — lệch minor version là **chấp nhận được**
cho dự án học, nhưng phải biết một thay đổi của 4.x:

> **RabbitMQ 4.x bỏ global QoS** (`basic.qos` với `global=true`) và bỏ classic queue mirroring.
> Code ở đây dùng `channel.prefetch(10)` trong `consumer.service.ts` — `amqplib` mặc định
> `global=false`, tức **per-consumer**, nên không bị ảnh hưởng. Nếu sau này ai đó đổi thành
> `channel.prefetch(10, true)` thì broker 4.x sẽ từ chối.

```bash
aws mq describe-broker-engine-types --engine-type RABBITMQ \
  --query 'BrokerEngineTypes[0].EngineVersions[].Name' --output text
```

### ⚠️ AMQPS, cổng 5671 — KHÁC local

| | Local (docker-compose) | Amazon MQ |
|---|---|---|
| scheme | `amqp://` | **`amqps://`** (TLS) |
| port | 5672 | **5671** |
| URL | `amqp://rabbitmq:5672` | `amqps://user:pass@b-xxx.mq.us-east-1.amazonaws.com:5671` |

`amqplib` hỗ trợ sẵn `amqps://`, không cần đổi code — nhưng sai scheme/port là
`ECONNREFUSED` hoặc handshake fail, và log của NestJS RMQ transport rất khó đọc.

Deployment mode `SINGLE_INSTANCE` (không `CLUSTER_MULTI_AZ`) — cluster đắt gấp 3 và không học thêm gì.

---

## ✅ Verify Ngày 1

```bash
aws rds describe-db-instances --region us-east-1 \
  --query 'DBInstances[].[DBInstanceIdentifier,DBInstanceStatus,Endpoint.Address]' --output table
aws elasticache describe-cache-clusters --region us-east-1 --show-cache-node-info \
  --query 'CacheClusters[].[CacheClusterId,CacheClusterStatus]' --output table
aws mq list-brokers --region us-east-1 --query 'BrokerSummaries[].[BrokerName,BrokerState]' --output table
```

- RDS: `available`, `psql` vào thấy đủ 3 database (`\l`)
- ElastiCache: `available`
- Amazon MQ: `RUNNING`

Xong 3 cái → sang [04-secrets.md](./04-secrets.md).

---

## 💸 Đây là nhóm ăn tiền 24/7

RDS + ElastiCache + Amazon MQ chạy liên tục, không tự tắt. Hết giờ học trong ngày:
**stop RDS** (`aws rds stop-db-instance`, tự start lại sau 7 ngày), cân nhắc xoá broker MQ nếu
hôm sau chưa dùng. Xem [COST_PLAN.md](./COST_PLAN.md).
