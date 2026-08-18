# common/ — Hạ tầng dùng chung cho cả ECS Fargate và EKS

Dựng **một lần** ở Ngày 1, dùng lại nguyên vẹn cho bậc 2 (EKS). Không dựng lại RDS/Redis/MQ khi sang k8s.

| File | Nội dung | Khi nào |
|---|---|---|
| [**CONSOLE_GUIDE.md**](./CONSOLE_GUIDE.md) | **Bản bấm Console cho toàn bộ Ngày 1** — dùng khi học lần đầu | Ngày 1 |
| [01-networking.md](./01-networking.md) | VPC + 3 security group (`sg-alb`/`sg-app`/`sg-data`) | Ngày 1.1 |
| [02-ecr.md](./02-ecr.md) | 5 repo ECR + lifecycle policy | Ngày 1.2 |
| [03-stateful.md](./03-stateful.md) | RDS Postgres 16 (3 DB) · ElastiCache Valkey · Amazon MQ RabbitMQ 4.2 | Ngày 1.3 |
| [04-secrets.md](./04-secrets.md) | Secrets Manager + cách ECS/EKS đọc secret | Ngày 1.4 |
| [setup-network.sh](./setup-network.sh) | Script tạo 3 SG (idempotent) | Ngày 1.1 |
| [setup-stateful.sh](./setup-stateful.sh) | Script tạo RDS + ElastiCache + Amazon MQ | Ngày 1.3 |
| [COST_PLAN.md](./COST_PLAN.md) | $190/15 ngày: thủ phạm ăn tiền, teardown hằng ngày | **đọc trước tiên** |

## Vì sao stateful KHÔNG nằm trong orchestrator

Orchestrator có thể **giết & reschedule** container bất cứ lúc nào (deploy, health-check fail, scale,
node chết). Container stateless bị giết → vô hại, tạo lại. Postgres bị giết mà không gắn persistent
volume đúng → **mất sạch data**. Chạy Postgres trên EFS/NFS còn là anti-pattern (fsync qua network).
→ Production **luôn** đẩy stateful ra managed service.

*(Bậc 2 có bài bonus cố tình chạy Postgres bằng `StatefulSet` + PVC để thấy tận mắt vì sao nó đau —
xem `../eks/manifests/90-postgres-statefulset.yaml`.)*

## Bảng phân vai

| Thành phần | Kiểu | Đặt ở đâu |
|---|---|---|
| api-gateway, auth, product, order, notification-worker | stateless | ECS Fargate (bậc 1) → EKS (bậc 2) |
| Postgres `auth_db`/`product_db`/`order_db` | stateful | **RDS** — 1 instance, 3 database |
| Redis | stateful | **ElastiCache Valkey** `cache.t3.micro` (rẻ hơn Redis OSS 20%, cùng giao thức) |
| RabbitMQ | stateful | **Amazon MQ** `mq.t3.micro`, RabbitMQ 4.2 (AMQPS :5671) |
| Email | external | SES (hoặc để mock) |
