# deploy/ — Script deploy

| | Dùng cho | File |
|---|---|---|
| **Dùng chung** | build & push 5 image lên ECR | [`push-ecr.sh`](./push-ecr.sh) |
| **Dùng chung** | danh sách biến môi trường của mọi service | [`env-template.txt`](./env-template.txt) |
| **Bậc 1 — ECS** | đăng ký 5 task definition | [`ecs/register-taskdefs.sh`](./ecs/register-taskdefs.sh) |
| **Bậc 1 — ECS** | deploy image mới (rolling) | [`ecs/deploy-ecs.sh`](./ecs/deploy-ecs.sh) |
| **Bậc 2 — EKS** | Secrets Manager → k8s Secret | [`eks/create-secrets.sh`](./eks/create-secrets.sh) |
| **Bậc 2 — EKS** | envsubst + apply manifest | [`eks/apply-manifests.sh`](./eks/apply-manifests.sh) |
| **Bậc 2 — EKS** | deploy image mới (rolling) | [`eks/deploy-eks.sh`](./eks/deploy-eks.sh) |

> Thư mục này **chỉ có bản CLI** — build/push image và deploy là việc lặp lại mỗi commit,
> bấm tay không có nghĩa. Bản bấm Console cho phần *hạ tầng* nằm ở
> [`../infra/*/CONSOLE_GUIDE.md`](../infra/README.md).

Hạ tầng (tạo cluster, ALB, RDS…) nằm ở [`../infra/`](../infra/). Pipeline tự động ở [`../cicd/`](../cicd/).

## Luồng chuẩn

```bash
export AWS_REGION=us-east-1
export TAG=$(git rev-parse --short HEAD)

./deploy/push-ecr.sh                       # 1. build + push (dùng cho cả 2 bậc)

# --- Bậc 1 ---
ACCOUNT_ID=... REDIS_HOST=... ./deploy/ecs/register-taskdefs.sh    # lần đầu / khi đổi env
./deploy/ecs/deploy-ecs.sh                                          # các lần sau

# --- Bậc 2 ---
./deploy/eks/create-secrets.sh             # lần đầu / khi đổi secret
./deploy/eks/apply-manifests.sh            # lần đầu / khi đổi manifest
./deploy/eks/deploy-eks.sh                 # các lần sau
```

## Nguyên tắc chung của 3 script deploy

- **Tag theo git SHA, không dùng `latest`.** `latest` là tag di động: 2 tuần sau bạn không biết
  production đang chạy commit nào, và `update-service`/`set image` với cùng tên tag có thể
  không kích hoạt deploy vì manifest không đổi. `push-ecr.sh` push cả `:$SHA` lẫn `:latest` —
  `latest` chỉ để tiện `docker pull` khi debug.
- **Chờ ổn định rồi mới báo xong.** `aws ecs wait services-stable` / `kubectl rollout status`
  trả exit code khác 0 khi deploy treo → CI fail đúng lúc thay vì báo xanh giả.
- **Không giá trị thật trong file commit.** Placeholder + `envsubst`, secret đọc từ Secrets Manager.

## `env-template.txt`

Liệt kê **tên** mọi biến của 5 service, kèm chú thích nguồn giá trị và các bẫy (SSL của RDS,
AMQPS của Amazon MQ, `GRPC_URL` phải bind `0.0.0.0`). Cột "Bậc 1 / Bậc 2" cho biết biến đó
được khai ở đâu: task definition, hay ConfigMap/Secret của k8s.
