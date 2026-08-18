# 04 — Secrets Manager

Một nơi lưu secret, **hai cách đọc**: ECS đọc qua `secrets[].valueFrom` (execution role),
EKS đọc qua `Secret` object (hoặc External Secrets Operator). Giá trị thì giống hệt nhau.

## Tạo secret

Lưu **1 secret dạng JSON** cho gọn (thay vì 5 secret rời):

```bash
RDS_HOST=<rds-endpoint>.us-east-1.rds.amazonaws.com
MQ_HOST=b-xxxx.mq.us-east-1.amazonaws.com

aws secretsmanager create-secret --region us-east-1 \
  --name ecommerce/app \
  --secret-string "{
    \"JWT_SECRET\":\"$(openssl rand -hex 32)\",
    \"AUTH_DATABASE_URL\":\"postgres://postgres:$PG_PASS@$RDS_HOST:5432/auth_db?sslmode=no-verify\",
    \"PRODUCT_DATABASE_URL\":\"postgres://postgres:$PG_PASS@$RDS_HOST:5432/product_db?sslmode=no-verify\",
    \"ORDER_DATABASE_URL\":\"postgres://postgres:$PG_PASS@$RDS_HOST:5432/order_db?sslmode=no-verify\",
    \"RABBITMQ_URL\":\"amqps://ecommerce:$MQ_PASS@$MQ_HOST:5671\"
  }"
```

**Lưu URL hoàn chỉnh, không lưu user/password rời.** Lý do: `DATABASE_URL` phải ghép
`user:pass@host/db` — mà task definition ECS **không nội suy biến** (`${A}` trong `environment`
là chuỗi literal, không phải template). Ghép sẵn 1 lần ở đây là cách duy nhất gọn.
Bậc 2 (EKS) dùng đúng bộ key này, không phải sửa gì.

Cập nhật về sau: `aws secretsmanager put-secret-value --secret-id ecommerce/app --secret-string '{...}'`.

> Danh sách đầy đủ biến của từng service: [`../../deploy/env-template.txt`](../../deploy/env-template.txt).

## Bậc 1 — ECS đọc thế nào

Task definition tham chiếu **từng key** trong secret JSON bằng cú pháp `<arn>:<key>::`:

```json
"secrets": [
  { "name": "JWT_SECRET",
    "valueFrom": "arn:aws:secretsmanager:us-east-1:<ACCOUNT_ID>:secret:ecommerce/app-AbCdEf:JWT_SECRET::" }
]
```

- Hai dấu `::` cuối là **bắt buộc** (chỗ dành cho version-stage / version-id, để trống).
- ARN có hậu tố 6 ký tự ngẫu nhiên do AWS sinh — lấy bằng
  `aws secretsmanager describe-secret --secret-id ecommerce/app --query ARN --output text`.
- Task def **không nội suy** biến — đó là lý do secret ở trên lưu sẵn URL đầy đủ thay vì user/pass rời.

### ⚠️ execution role vs task role (rất hay bị hỏi phỏng vấn)

| | Ai dùng | Để làm gì |
|---|---|---|
| **execution role** | ECS agent, *trước khi* container chạy | kéo image từ ECR, đọc Secrets Manager, ghi CloudWatch Logs |
| **task role** | code trong container (AWS SDK) | gọi SES, S3, DynamoDB… lúc runtime |

Gán nhầm: quyền secret đặt ở task role → task **không start được** (`ResourceInitializationError`);
quyền SES đặt ở execution role → container chạy nhưng SES `AccessDenied`.

Execution role cần policy `AmazonECSTaskExecutionRolePolicy` **+** inline cho phép
`secretsmanager:GetSecretValue` trên ARN secret ở trên.

## Bậc 2 — EKS đọc thế nào

Cách nhanh (đủ cho learning): sinh `Secret` từ AWS CLI, apply vào cluster.

```bash
./deploy/eks/create-secrets.sh      # đọc Secrets Manager → kubectl create secret
```

Cách chuẩn production: **External Secrets Operator** hoặc **Secrets Store CSI Driver** +
**IRSA** (IAM Roles for Service Accounts) → pod tự lấy secret, không có bản copy trong etcd.
IRSA chính là "task role" của thế giới k8s — nói được cặp tương ứng này là điểm cộng phỏng vấn.

> `kubectl create secret` chỉ base64, **không mã hoá**. Đừng commit file Secret YAML có giá trị thật —
> `../eks/manifests/02-secret.example.yaml` chỉ là mẫu, giá trị để trống.

## Điều tuyệt đối không làm

- Không đưa password vào `environment` của task def / `ConfigMap` — cả hai hiện plaintext trong console.
- Không commit `.env` thật. `deploy/env-template.txt` chỉ liệt kê **tên** biến.
