# Bậc 1 — ECS Fargate (Ngày 1–4) 🔴 phải đáp đất

> Mục tiêu: `curl http://<ALB-DNS>/products` ra data, đặt hàng chạy end-to-end.
> Đây là phần **tối thiểu phải xong** — có nó là đã có câu chuyện deploy hoàn chỉnh cho phỏng vấn,
> kể cả khi account chết trước khi kịp làm EKS.

Vì sao ECS trước EKS: Fargate giấu việc quản node → ít bộ phận chuyển động nhất, lên "chạy được"
nhanh; nhưng vẫn dạy đủ nền tảng dùng lại nguyên vẹn ở bậc 2 (ECR, IAM role, security group,
service discovery, load balancer, secret injection, rolling deploy).

## Kiến trúc

```
                Internet
                   │  :80
              ┌────▼─────┐
              │   ALB    │  sg-alb, public subnet
              └────┬─────┘
                   │ HTTP :3000, health check /health
        ┌──────────▼──────── ECS cluster "ecommerce" (Fargate) ──────────┐
        │  api-gateway ← service duy nhất gắn target group               │
        │      │ gRPC qua Cloud Map: <svc>.microservice.local            │
        │      ├──► auth-service    :50051                               │
        │      ├──► product-service :50052 ◄──┐                          │
        │      └──► order-service   :50053 ───┘                          │
        │                    │ publish (AMQPS)                           │
        │             notification-worker (consume, không portMapping)   │
        └──────┬─────────────┬────────────────┬─────────────────────────-┘
               │ 5432        │ 6379           │ 5671        (sg-app → sg-data)
          RDS Postgres   ElastiCache      Amazon MQ         ← xem ../common/
```

## Hai đường

- 🖱️ **Bấm Console (học lần đầu)** → [`CONSOLE_GUIDE.md`](./CONSOLE_GUIDE.md)
- ⌨️ **CLI (dựng lại nhanh / CI)** → phần dưới đây

## Chạy theo thứ tự (CLI)

```bash
export AWS_REGION=us-east-1

# --- Ngày 1: phần dùng chung (xem ../common/) ---
./infra/common/setup-network.sh                  # → SG_ALB, SG_APP, SG_DATA
export SG_ALB=... SG_APP=... SG_DATA=...
SG_DATA=$SG_DATA POSTGRES_PASSWORD='...' MQ_PASSWORD='...' ./infra/common/setup-stateful.sh
./deploy/push-ecr.sh                             # chạy song song lúc chờ stateful
# tạo 3 database + đẩy secret: ../common/03-stateful.md, ../common/04-secrets.md

# --- Ngày 2: stateless ---
./infra/ecs-fargate/setup-cluster.sh             # cluster + 2 IAM role + Cloud Map
export ACCOUNT_ID=... NS_ID=... SECRET_SUFFIX=...
./infra/ecs-fargate/setup-alb.sh                 # → TG_ARN, ALB_DNS
export TG_ARN=... ALB_DNS=...
./deploy/ecs/register-taskdefs.sh                # điền placeholder → register 5 task def
./infra/ecs-fargate/create-services.sh           # 5 ECS service
./infra/ecs-fargate/run-oneoff-task.sh migration
./infra/ecs-fargate/run-oneoff-task.sh seed      # tuỳ chọn, để /products có data
```

## Task definition

[`taskdef/`](./taskdef/) — 5 file JSON, để **placeholder** dạng `${ACCOUNT_ID}` / `${AWS_REGION}` /
`${TAG}` / `${REDIS_HOST}` / `${SECRET_SUFFIX}`. `deploy/ecs/register-taskdefs.sh` thay bằng
`envsubst` rồi `aws ecs register-task-definition`. Không commit giá trị thật vào đây.

| Service | portMappings | environment | secrets |
|---|---|---|---|
| api-gateway | 3000 | 3 × `*_GRPC_URL`, `REDIS_URL` | `JWT_SECRET` |
| auth-service | 50051 | `GRPC_URL`, `REDIS_URL`, TTL token | `JWT_SECRET`, `DATABASE_URL` |
| product-service | 50052 | `GRPC_URL` | `DATABASE_URL` |
| order-service | 50053 | `GRPC_URL`, `PRODUCT_GRPC_URL`, timeout | `DATABASE_URL`, `RABBITMQ_URL` |
| notification-worker | *(không có)* | `AWS_REGION`, `SES_FROM_EMAIL` | `RABBITMQ_URL` |

Sizing 0.25 vCPU / 0.5 GB cho mọi service — thừa cho learning, và là combo Fargate rẻ nhất.

## Service discovery (Cloud Map)

Namespace private DNS `microservice.local`. Mỗi ECS service đăng ký 1 Cloud Map service
→ A record `auth-service.microservice.local` trỏ tới IP của task.

- **`GRPC_URL` phải là `0.0.0.0:5005x`**, không phải `localhost` — bind localhost thì task khác
  không gọi vào được (awsvpc mode, mỗi task 1 ENI riêng).
- **Thứ tự khởi động không quan trọng**: gRPC client của gateway nối *lười*, tới request đầu mới nối.
- TTL 15s + routing policy MULTIVALUE → task chết/thay thì client hết cache DNS nhanh.

## ALB

- Target group **`targetType=ip`** — bắt buộc với Fargate awsvpc (target là ENI của task).
- Health check `/health` (đã `@SkipThrottle()` trong `health.controller.ts` — không thì ALB gọi
  liên tục sẽ ăn 429 từ ThrottlerGuard).
- `healthCheckGracePeriodSeconds=90` cho api-gateway.
- **Chỉ api-gateway** gắn ALB. 4 service kia chỉ nói chuyện nội bộ qua sg-app.

## Migration & seed

Prod **không** set `SEED_ON_BOOT` (đúng chủ ý) → `product_db` rỗng sau deploy đầu, `GET /products`
trả `[]`. Chạy one-off task:

```bash
./infra/ecs-fargate/run-oneoff-task.sh migration
./infra/ecs-fargate/run-oneoff-task.sh seed
```

⚠️ **`npm run migration:run` KHÔNG chạy được trong image production** — script đó gọi
`typeorm-ts-node-commonjs` trên `src/`, mà image đã `npm prune --production` và không copy `src/`.
Script trên gọi thẳng `node node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js`
(`typeorm` là dependency runtime nên có sẵn trong image). Seed thì dùng `npm run seed:prod` đã có.

## ✅ Verify cuối Ngày 2

```bash
curl http://$ALB_DNS/health                      # 200 {"status":"ok"}
curl http://$ALB_DNS/products                    # gateway → product gRPC → RDS
curl -X POST http://$ALB_DNS/auth/register -H 'Content-Type: application/json' \
     -d '{"email":"a@b.com","password":"secret123"}'
curl -X POST http://$ALB_DNS/auth/login    ...   # nhận JWT → auth + ElastiCache OK
curl -X POST http://$ALB_DNS/orders -H "Authorization: Bearer $JWT" ...
aws logs tail /ecs/notification-worker --region us-east-1 --since 5m   # thấy event → MQ OK
```

## Failure mode hay gặp (phần "thịt" để trả lời phỏng vấn)

| Triệu chứng | Nguyên nhân |
|---|---|
| Task `PENDING` → `STOPPED`, `CannotPullContainerError` | thiếu public IP ở public subnet (hoặc thiếu NAT ở private) → không ra được ECR |
| Task chết ngay, `exec format error` | image build trên Apple Silicon thiếu `--platform linux/amd64` |
| `ResourceInitializationError: unable to pull secrets` | quyền `secretsmanager:GetSecretValue` đặt ở **task role** thay vì **execution role** |
| Container chạy nhưng SES `AccessDenied` | ngược lại — quyền SES đặt ở execution role thay vì task role |
| gateway 504, log `DEADLINE_EXCEEDED` | `sg-app` chưa mở 50051–53 cho **chính nó**, hoặc quên đăng ký Cloud Map |
| Postgres `no pg_hba.conf entry ... SSL off` | RDS force SSL — `DATABASE_URL` thiếu `?sslmode=no-verify` |
| RMQ `ECONNREFUSED` / handshake fail | dùng `amqp://...:5672` thay vì **`amqps://...:5671`** (Amazon MQ là TLS) |
| Task restart vô tận, ALB báo unhealthy | grace period quá ngắn — NestJS chưa boot xong đã bị giết |

## Sau khi xong

1. CI/CD cho ECS → [`../../cicd/README.md`](../../cicd/README.md) (Ngày 3, 🔴)
2. Buffer/hardening (Ngày 4): đọc CloudWatch log, siết IAM, chỉnh grace period
3. Bậc 2 → [`../eks/README.md`](../eks/README.md) (Ngày 5–11)

Khi sang bậc 2, **giữ nguyên** stateful ở `../common/`. Muốn tiết kiệm thì hạ ECS service về 0
thay vì xoá — bật lại 1 lệnh khi cần demo so sánh ECS ↔ EKS:

```bash
for s in api-gateway auth-service product-service order-service notification-worker; do
  aws ecs update-service --cluster ecommerce --service $s --desired-count 0 --region us-east-1
done
```
