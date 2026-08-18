# legacy-ec2/ — CI/CD cho phương án cũ (1 EC2 + docker-compose)

**Không dùng nữa.** `note/next-plan.md` đã pivot sang ECS Fargate → EKS.
Giữ lại vì: (a) là bản ghi cách làm "CodeDeploy trên EC2", vẫn hay gặp ở dự án thật;
(b) so sánh CodeDeploy/EC2 ↔ ECS rolling ↔ k8s rollout là câu trả lời phỏng vấn tốt.

| File | Vai trò cũ |
|---|---|
| `CICD_SETUP.md` | hướng dẫn Route A (GitHub Actions + SSH) và Route B (CodePipeline + CodeDeploy) |
| `deploy-ec2.yml` | workflow SSH vào EC2 → `docker compose pull && up -d` |
| `appspec.yml` | CodeDeploy: copy file + gọi 3 hook |
| `scripts/{stop,install,start}.sh` | hook ApplicationStop / AfterInstall / ApplicationStart |

Hạ tầng tương ứng: [`../../infra/legacy-ec2/`](../../infra/legacy-ec2/).
Phiên bản đang dùng: [`../README.md`](../README.md).

## Khác biệt cốt lõi so với bản mới

| | EC2 + CodeDeploy (cũ) | ECS/EKS (mới) |
|---|---|---|
| Đơn vị deploy | file trên host + `docker compose up` | task definition / manifest |
| Downtime | có — `compose down` rồi `up` | không — rolling, task/pod mới khoẻ rồi mới rút cái cũ |
| Rollback | deploy lại commit cũ (build lại) | trỏ về revision/ReplicaSet cũ |
| Stateful | Postgres/Redis/RabbitMQ chạy chung 1 máy | managed (RDS/ElastiCache/Amazon MQ) |
| Máy chết | mất cả hệ | orchestrator reschedule sang node khác |
