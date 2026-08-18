# 02 — ECR (image registry dùng chung)

Cùng 5 image phục vụ **cả ECS Fargate lẫn EKS**. Không build lại khi sang bậc 2 — bậc 2 chỉ đổi
cách *chạy* image, không đổi image.

## Tạo repo + build + push

Script làm hết (tạo repo nếu chưa có, build 5 image, push):

```bash
AWS_REGION=us-east-1 ./deploy/push-ecr.sh
```

Xem [`../../deploy/README.md`](../../deploy/README.md) để biết các biến điều khiển (`TAG`, `SERVICES`, `PLATFORM`).

## 3 điều bắt buộc đúng khi build

| Cờ | Vì sao |
|---|---|
| build context là **ROOT repo** (`.`) | Dockerfile `COPY proto/` **và** `services/<svc>/` — context là thư mục service sẽ thiếu `proto/` |
| `--target production` | multi-stage: stage `production` đã `npm prune --production`, không có devDeps |
| `--platform linux/amd64` | Fargate & node group `t3.*` là x86_64. Build trên Apple Silicon quên cờ này → task chết ngay với **`exec format error`** |

> Nếu bậc 2 dùng node group Graviton (`t4g.*`) thì phải build `linux/arm64`.
> Kế hoạch hiện tại giữ x86_64 cho cả 2 bậc → build 1 lần dùng cho cả hai.

## Lifecycle policy (giữ ECR gần như free)

Mỗi commit push 1 tag mới → repo phình. Giữ tối đa 5 image/repo:

```bash
for s in api-gateway auth-service product-service order-service notification-worker; do
  aws ecr put-lifecycle-policy --region us-east-1 --repository-name "$s" \
    --lifecycle-policy-text '{"rules":[{"rulePriority":1,"description":"keep last 5",
      "selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":5},
      "action":{"type":"expire"}}]}'
done
```

> Từ 01/2026 ECR dedupe layer **trên toàn registry**: 5 service dùng chung base `node:24-alpine`
> nên layer base chỉ tốn dung lượng 1 lần cho cả 5 repo. Tự động, không cần đổi cách build.

## Verify

```bash
aws ecr list-images --repository-name api-gateway --region us-east-1
# và kiểm tra kiến trúc image (phải là amd64):
aws ecr batch-get-image --repository-name api-gateway --region us-east-1 \
  --image-ids imageTag=latest --query 'images[0].imageManifest' --output text | head -c 400
```
