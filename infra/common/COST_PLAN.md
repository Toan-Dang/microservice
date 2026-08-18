# COST_PLAN — $190 cho 15 ngày, region us-east-1

> Lập cho kế hoạch [`note/next-plan.md`](../../note/next-plan.md) (ECS Fargate → EKS).
> Bản cũ cho phương án 1-EC2/ap-southeast-1 nằm ở [`../legacy-ec2/COST_PLAN.md`](../legacy-ec2/COST_PLAN.md).
>
> **Đối chiếu tài liệu AWS ngày 18/08/2026.** Ô ✅ = lấy trực tiếp từ trang pricing chính thức của AWS.
> Ô ❓ = chưa xác minh lại trong lần rà này (trang pricing render bằng JS, không đọc được tự động) →
> **kiểm ở [AWS Pricing Calculator](https://calculator.aws) trước khi bấm Create.**

---

## 1. Kết luận ngắn

| Câu hỏi | Trả lời |
|---|---|
| Chạy 24/7 cả 15 ngày (ECS + EKS chồng nhau giai đoạn sau) tốn bao nhiêu? | **≈ $110 – 125** |
| $190 có đủ không? | **Đủ, dư ~$65 làm đệm.** Ngân sách không phải ràng buộc — *thời gian* mới là |
| Thứ đắt nhất | **EKS control plane $2.40/ngày** (cố định, kể cả cluster rỗng) — và **$14.40/ngày** nếu chọn nhầm version đã hết standard support |
| Thứ dễ quên nhất | **NAT Gateway** (~$1/ngày) — kế hoạch này **né hoàn toàn** bằng public subnet |
| Cách tiết kiệm hiệu quả nhất | Xoá node group + ALB/Ingress khi hết giờ học; **stop RDS** ban đêm |

**$190 là trần, không phải chỉ tiêu.** Dư credit không mất đi — nó là bảo hiểm cho việc quên tắt
node group một đêm hoặc HPA scale lên bất ngờ ở Ngày 9.

---

## 2. Đơn giá (us-east-1, on-demand)

| | Tài nguyên | Đơn giá | $/ngày (24h) | Bậc |
|---|---|---|---|---|
| ✅ | **EKS control plane — standard support** | **$0.10/h** | **$2.40** | 2 |
| ✅ | **EKS control plane — extended support** ⚠️ | **$0.60/h** | **$14.40** | 2 |
| ✅ | Fargate: vCPU $0.040478/h + GB $0.004446/h → 5 task × (0.25 vCPU / 0.5 GB) | $0.012343/task-h | **$1.48** | 1 |
| ✅ | ALB | $0.0225/h + $0.008/LCU-h | **$0.55** + LCU | 1 (+2 qua Ingress) |
| ❓ | EKS node group 2 × `t3.medium` | ~$0.0416/h mỗi node | **$2.00** | 2 |
| ❓ | RDS `db.t3.micro` Postgres, single-AZ | ~$0.017/h | **$0.41** | 1 + 2 |
| ❓ | RDS storage 20 GB gp3 | ~$0.08/GB-tháng | $0.05 | 1 + 2 |
| ❓ | ElastiCache `cache.t3.micro` **Valkey** | ~$0.014/h (Valkey rẻ hơn Redis OSS **20%**) | **$0.33** | 1 + 2 |
| ❓ | Amazon MQ `mq.t3.micro` RabbitMQ, single | ~$0.036/h | **$0.86** | 1 + 2 |
| ❓ | ECR (≤ 5 image/repo, layer dedupe) | ~$0.10/GB-tháng | ~$0.01 | chung |
| ❓ | CloudWatch Logs | ~$0.50/GB ingest | ~$0.05 | chung |
| ❓ | Secrets Manager | ~$0.40/secret-tháng | ~$0.01 | chung |
| | ~~NAT Gateway~~ | ~~$0.045/h + data~~ | ~~$1.08~~ | **né bằng public subnet** |

### ⚠️ Bẫy đắt nhất: EKS extended support

Mỗi minor version Kubernetes có **standard support 14 tháng** trên EKS, sau đó **tự động** chuyển
sang extended support và giá control plane nhảy **$0.10/h → $0.60/h**. Không có cảnh báo chặn,
không cần bạn làm gì — chỉ là một ngày hoá đơn tăng gấp 6.

Tính tới 08/2026: standard = **1.34 / 1.35 / 1.36**. **1.33 đã hết ngày 29/07/2026.**
`cluster.yaml` dùng **1.35**. Kiểm tra trước khi tạo cluster:

```bash
aws eks describe-cluster-versions --region us-east-1 \
  --query 'clusterVersions[].[clusterVersion,versionStatus,endOfStandardSupportDate]' --output table
```

Chọn nhầm 1.31 (như bản nháp đầu của kế hoạch này) = **$14.40/ngày** thay vì $2.40 →
riêng 11 ngày EKS đã là **$158**, gần hết sạch $190.

---

## 3. Dự phóng theo lịch 15 ngày

| Giai đoạn | Ngày | Đang chạy | $/ngày | Tổng |
|---|---|---|---|---|
| Bậc 1 — ECS | 1–4 | stateful + ALB + 5 Fargate task | $3.70 | **$15** |
| Bậc 2 — EKS (giữ luôn ECS để so sánh) | 5–11 | trên + EKS CP + 2 node + Ingress ALB | $8.65 | **$61** |
| Buffer / hardening | 12–15 | như trên | $8.65 | **$35** |
| Lặt vặt (logs, transfer, CodeBuild nếu dùng) | — | — | — | **~$10** |
| | | | **Tổng** | **≈ $121** |

**Nếu tắt ECS service (`--desired-count 0`) khi sang bậc 2** → tiết kiệm ~$2.0/ngày × 11 ngày ≈ **$22**.
Task definition vẫn còn nguyên, bật lại 1 lệnh khi cần demo — nên đây là cắt giảm "miễn phí".

---

## 4. Teardown hằng ngày (thói quen nên có)

Hết giờ học trong ngày:

```bash
# EKS: xoá node group (control plane vẫn tính tiền, nhưng node là phần lớn chi phí compute)
eksctl scale nodegroup --cluster ecommerce --name ng-1 --nodes 0 --nodes-min 0

# ECS: hạ desired count về 0
for s in api-gateway auth-service product-service order-service notification-worker; do
  aws ecs update-service --cluster ecommerce --service $s --desired-count 0 --region us-east-1
done

# RDS: stop (AWS tự start lại sau 7 ngày — nhớ stop lại)
aws rds stop-db-instance --db-instance-identifier ecommerce-pg --region us-east-1
```

**Giữ lại**: ECR, Secrets Manager, security group, task definition, manifest — gần như free và
dựng lại tốn thời gian.

**Xoá hẳn khi kết thúc dự án** (theo thứ tự, tránh dependency lỗi):

```bash
# 1. Ingress/ALB trước (nếu xoá cluster trước, ALB thành mồ côi vẫn tính tiền)
kubectl delete ingress --all -n ecommerce
# 2. EKS cluster
eksctl delete cluster --name ecommerce --region us-east-1
# 3. ECS cluster + ALB bậc 1
aws elbv2 delete-load-balancer --load-balancer-arn <arn> --region us-east-1
aws ecs delete-cluster --cluster ecommerce --region us-east-1
# 4. Stateful
aws rds delete-db-instance --db-instance-identifier ecommerce-pg --skip-final-snapshot --region us-east-1
aws elasticache delete-cache-cluster --cache-cluster-id ecommerce-redis --region us-east-1
aws mq delete-broker --broker-id <broker-id> --region us-east-1
```

> ⚠️ **ALB mồ côi** là bẫy phổ biến nhất: xoá EKS cluster mà quên xoá Ingress → AWS Load Balancer
> Controller không còn để dọn → ALB sống tiếp $0.55/ngày cho tới khi bạn phát hiện ra hoá đơn.
> Luôn `kubectl delete ingress` **trước** `eksctl delete cluster`.

---

## 5. Cảnh báo chi phí

```bash
# Budget $150 (ngưỡng cảnh báo, dưới trần $190) — thay <EMAIL>
aws budgets create-budget --account-id "$(aws sts get-caller-identity --query Account --output text)" \
  --budget '{"BudgetName":"ecommerce-15d","BudgetLimit":{"Amount":"150","Unit":"USD"},
             "TimeUnit":"MONTHLY","BudgetType":"COST"}' \
  --notifications-with-subscribers '[{"Notification":{"NotificationType":"ACTUAL",
      "ComparisonOperator":"GREATER_THAN","Threshold":80},
      "Subscribers":[{"SubscriptionType":"EMAIL","Address":"<EMAIL>"}]}]'
```

Kiểm tra chi tiêu thực tế bất cứ lúc nào:

```bash
aws ce get-cost-and-usage --time-period Start=$(date -d '7 days ago' +%F),End=$(date +%F) \
  --granularity DAILY --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE --output table
```

**Chạm $100 khi chưa sang bậc 2** = có gì đó chạy ngoài ý muốn. Nghi phạm theo thứ tự:
**EKS version rơi vào extended support ($0.60/h)** → NAT Gateway lỡ tạo → ALB mồ côi →
node group quên scale về 0 → RDS Multi-AZ bật nhầm.

---

## 6. Nguồn (đối chiếu 18/08/2026)

- [Amazon EKS Pricing](https://aws.amazon.com/eks/pricing/) — $0.10/h standard, $0.60/h extended
- [EKS Kubernetes version lifecycle](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html)
  và [release notes standard support](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions-standard.html) — 1.34/1.35/1.36
- [AWS Fargate Pricing](https://aws.amazon.com/fargate/pricing/) — $0.040478/vCPU-h, $0.004446/GB-h
- [Elastic Load Balancing Pricing](https://aws.amazon.com/elasticloadbalancing/pricing/) — ALB $0.0225/h + $0.008/LCU-h
- [ElastiCache Pricing](https://aws.amazon.com/elasticache/pricing/) — Valkey rẻ hơn Redis OSS 20% (node-based)
- [RDS for PostgreSQL release calendar](https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-release-calendar.html) — PG16 standard support tới 11/2028
- [Amazon MQ RabbitMQ version support](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/rabbitmq-version-support.html) — 4.2 khuyến nghị, 3.13 còn hỗ trợ
