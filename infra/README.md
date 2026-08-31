# infra/ — Hạ tầng AWS

> Nguồn kế hoạch: [`note/next-plan.md`](../note/next-plan.md).
> Region: **us-east-1**. Ngân sách: **$190 / 15 ngày**.

Deploy đi **thang 2 bậc**, cùng một hệ thống, hai orchestrator khác nhau:

| Bậc | Thư mục | Ngày | Nội dung |
|---|---|---|---|
| **1 — ECS Fargate** | [`ecs-fargate/`](./ecs-fargate/) | 1–4 | Task definition, Cloud Map, ALB, one-off migration/seed |
| **2 — EKS (Kubernetes)** | [`eks/`](./eks/) | 5–11 | eksctl cluster, Deployment/Service, Ingress, probe, HPA, StatefulSet bonus |
| *(cũ, đã pivot)* | [`legacy-ec2/`](./legacy-ec2/) | — | 1 EC2 + docker-compose. **Không dùng nữa**, giữ để tham chiếu |

**Cả hai bậc dùng chung** phần trong [`common/`](./common/) — không dựng lại: cùng VPC, cùng
security group, **cùng RDS / ElastiCache / Amazon MQ**, cùng ECR, cùng Secrets Manager.
Đây là chủ ý: bậc 2 chỉ đổi *lớp orchestration*, mọi thứ stateful giữ nguyên → não dồn 100% vào học k8s.

```
                       ┌──────────────── common/ (dựng 1 lần, Ngày 1) ─────────────────┐
                       │  VPC + sg-alb/sg-app/sg-data  ·  ECR ×5  ·  Secrets Manager   │
                       │  RDS Postgres 16 (3 DB) · ElastiCache Valkey · Amazon MQ RabbitMQ 4.2 │
                       └───────────┬────────────────────────────────┬─────────────────-┘
                                   │                                │
                    ┌──────────────▼──────────────┐  ┌──────────────▼──────────────┐
                    │  Bậc 1 — ECS Fargate        │  │  Bậc 2 — EKS                │
                    │  task def + ECS service     │  │  Deployment + Service       │
                    │  Cloud Map (*.microservice. │  │  CoreDNS (*.svc.cluster.    │
                    │    local)                   │  │    local)                   │
                    │  ALB + target group :3000   │  │  Ingress (ALB Controller)   │
                    └─────────────────────────────┘  └─────────────────────────────┘
```

## Hai đường đi: Console để HỌC, CLI để LẶP LẠI

Mỗi phần có **cả hai bản**, nội dung tương đương:

| | `CONSOLE_GUIDE.md` | Script `.sh` / manifest |
|---|---|---|
| Dùng khi | **học lần đầu** | dựng lại, hoặc đã hiểu và muốn nhanh |
| Ưu | thấy tận mắt mọi trường cấu hình, Console gợi ý giá trị hợp lệ, đọc lỗi dễ | lặp lại chính xác, review được bằng git, cắm thẳng vào CI/CD |
| Nhược | 30 bước bấm không ghi lại được, làm lại là bấm lại từ đầu | không thấy được cái mình không biết là mình chưa biết |

**Khuyến nghị: bấm Console lần đầu cho từng bậc, rồi đọc script tương ứng để đối chiếu.**
Script có comment giải thích *vì sao* mỗi cờ tồn tại — đó là phần Console không dạy được.
Phỏng vấn hỏi "bạn deploy thế nào" thì câu trả lời tốt là mô tả được cả hai và biết khi nào dùng cái nào.

| Phần | Console | CLI |
|---|---|---|
| Hạ tầng chung | [common/CONSOLE_GUIDE.md](./common/CONSOLE_GUIDE.md) | `common/setup-*.sh` |
| Bậc 1 — ECS | [ecs-fargate/CONSOLE_GUIDE.md](./ecs-fargate/CONSOLE_GUIDE.md) | `ecs-fargate/*.sh` + `taskdef/` |
| Bậc 2 — EKS | [eks/CONSOLE_GUIDE.md](./eks/CONSOLE_GUIDE.md) | `eks/cluster.yaml` + `manifests/` |
| CI/CD | [../cicd/CONSOLE_GUIDE.md](../cicd/CONSOLE_GUIDE.md) | `../cicd/github-actions/` |

> ⚠️ **Push image lên ECR bắt buộc dùng terminal** — Console không upload image được.
> Đó là chỗ duy nhất ở Ngày 1 không có đường Console.
> ⚠️ **EKS không làm hết bằng Console được**: tạo Deployment/Service/Ingress phải dùng `kubectl`.
> Lý do và ranh giới AWS ↔ Kubernetes: [eks/CONSOLE_GUIDE.md](./eks/CONSOLE_GUIDE.md) đầu bài.

## Thứ tự làm

1. `common/` → [01-networking.md](./common/01-networking.md), [02-ecr.md](./common/02-ecr.md), [03-stateful.md](./common/03-stateful.md), [04-secrets.md](./common/04-secrets.md)
2. `ecs-fargate/README.md` → chạy được end-to-end qua ALB (🔴 phải đáp đất)
3. CI/CD cho ECS → [`../cicd/README.md`](../cicd/README.md)
4. `eks/README.md` → dựng lại chính hệ đó trên Kubernetes (🟡 stretch giá trị cao)

Chi phí: [`common/COST_PLAN.md`](./common/COST_PLAN.md) — **đọc trước khi bấm Create bất cứ thứ gì.**
Xoá sạch an toàn (đúng thứ tự, không sót ALB/EIP mồ côi): [**`TEARDOWN.md`**](./TEARDOWN.md).

## File dùng chung không nằm trong common/

- `init-multiple-dbs.sh` — giữ ở gốc `infra/` vì `docker-compose.yml` và `docker-compose.prod.yml`
  bind-mount đúng đường dẫn `./infra/init-multiple-dbs.sh`. Trên AWS nó không được dùng
  (RDS tạo database bằng `psql`, xem `common/03-stateful.md`), chỉ phục vụ stack local.

## Ghi chú về CLAUDE.md

`CLAUDE.md` §"Điều KHÔNG làm" viết *"Không thêm RDS/ElastiCache/Amazon MQ/Fargate (giữ chi phí ~$0)"*.
Ràng buộc đó thuộc kế hoạch cũ (deploy 1 EC2, ngân sách ~$0). `note/next-plan.md` **đã pivot** sang
mục tiêu học-để-phỏng-vấn với ngân sách $190/15 ngày → managed stateful + orchestrator là *có chủ đích*.
Nếu giữ repo lâu dài, nên sửa lại dòng đó trong `CLAUDE.md` cho khớp.
