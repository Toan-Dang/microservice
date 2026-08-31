# next-plan.md — Deploy lên AWS: ECS Fargate (2 ngày) → EKS (ngày 3–15)

> **Pivot note.** File này thay thế kế hoạch cũ "Day 5 — deploy EC2" (nay lưu ở `infra/legacy-ec2/`).
> Lý do pivot: budget không còn là ràng buộc ($190 dùng trong 15 ngày trước khi account hết hạn),
> mục tiêu chuyển sang **học để phỏng vấn/đi làm** → deploy bằng orchestrator (thứ ngành thực sự dùng),
> không phải `docker-compose` trên 1 EC2 (setup hobby, học được ít).
>
> Region: **us-east-1**. Ngân sách: **$190 / 15 ngày**. Thời gian: **3–4h/ngày** (có job fulltime).
> Nền tảng người học: chưa từng deploy gì, chưa từng dùng Kubernetes.

---

## 0. Quyết định kiến trúc & vì sao đi thang 2 bậc

**Không nhảy thẳng EKS.** Người mới hoàn toàn + 2 ngày + EKS = copy-paste manifest không hiểu →
đúng thứ khiến rớt phỏng vấn khi bị hỏi sâu. Thay vào đó:

| Bậc | Thời gian | Mục tiêu | Vì sao |
|---|---|---|---|
| **1. ECS Fargate** | Ngày 1–2 | Deploy thành công toàn hệ, chạy end-to-end | Ít bộ phận chuyển động nhất (Fargate giấu việc quản node), lên "chạy được" nhanh; vẫn dạy đủ nền: ECR, task definition, ALB, security group, IAM role, service discovery, Secrets Manager. ECS cũng là keyword tuyển dụng phổ biến. |
| **2. EKS (Kubernetes)** | Ngày 3–15 | Dựng lại chính hệ đó trên k8s | Sau bậc 1 đã hiểu app + networking → dồn 100% não học *riêng* Kubernetes. Đây là skill transferable, giá trị phỏng vấn cao nhất. So sánh ECS↔EKS là câu chuyện interview mạnh. |

**Nguyên tắc "chuẩn nhất": tách vai trò stateless vs stateful.** Không nhét tất cả vào orchestrator.

### 0b. Day 6 (CI/CD) & Day 7 (payment) nằm ở đâu — cân đối theo đồng hồ AWS

**Không phải việc nào cũng "ăn" 15 ngày AWS như nhau.** Phân loại lại:

| Việc | Cần AWS sống? | Xếp lịch |
|---|---|---|
| ECS Fargate deploy (bậc 1) | ✅ | Ngày 1–2 (đường găng) |
| **Day 6 — CI/CD** | ✅ (deploy target) | **KHÔNG là ngày riêng** — nối vào ECS ngay khi ECS chạy (ngày 3), rồi mở rộng sang EKS |
| EKS (bậc 2) | ✅ | Ngày 5–11 |
| **Day 7 — payment mock** | ❌ (logic nghiệp vụ, dev local bằng docker-compose) | **RA KHỎI đường găng AWS** — làm rải rác buổi tối / SAU khi account hết hạn, hoặc gộp vào phase 2 outbox |

- **Day 7** không tiêu account: phát triển local, không vội. Deploy nó lên cloud chỉ là lặp pattern "thêm 1 service" (~20 phút nếu account còn sống) — không đáng để chiếm ngày AWS quý giá.
- **Day 6** làm **sớm** (ngay sau ECS) vì: (a) setup còn nóng trong đầu; (b) *de-risk* — nếu EKS trượt lịch, vẫn còn nguyên câu chuyện deploy + CI/CD hoàn chỉnh cho phỏng vấn; (c) mọi thay đổi về sau tự động deploy, đỡ thao tác tay.

**Ưu tiên khi thời gian ép:** *phải đáp đất* = ECS + CI/CD (ngày 1–4) → luôn giữ được hệ chạy được + pipeline kể cả khi account chết. *Stretch giá trị cao* = EKS (ngày 5–11). Buffer ngày 12–15 chống trượt lịch (người mới hay trượt).

---

## 1. Kiến trúc đích (bậc 1 — ECS Fargate)

```
                Internet
                   │  :80 / :443
              ┌────▼─────┐
              │   ALB    │  (public subnet)   ← điểm vào REST DUY NHẤT
              └────┬─────┘
                   │ HTTP :3000  (health check /health)
        ┌──────────▼──────────── ECS Fargate cluster ───────────────────────┐
        │  api-gateway (REST)                                                 │
        │      │ gRPC (service discovery qua AWS Cloud Map: *.microservice.local)
        │      ├──► auth-service    :50051                                    │
        │      ├──► product-service :50052 ◄──┐                               │
        │      └──► order-service   :50053 ───┘ (order → product qua gRPC)    │
        │                    │ publish                                        │
        │             notification-worker (consume RMQ, không cổng)           │
        └──────┬─────────────┬────────────────┬──────────────────────────────┘
               │             │                │
         ┌─────▼────┐  ┌─────▼─────┐   ┌──────▼───────┐
         │   RDS    │  │ElastiCache│   │  Amazon MQ   │   ← STATEFUL = managed
         │ Postgres │  │  Redis    │   │ (RabbitMQ)   │
         │ 3 DB     │  └───────────┘   └──────────────┘
         └──────────┘
```

### Trả lời trực tiếp: "deploy cả stateful và stateless được không?"

**Được — nhưng cách CHUẨN là tách nơi đặt**, không phải nhét chung.

| Thành phần | Kiểu | Đặt ở đâu (production-correct) | Học được gì |
|---|---|---|---|
| api-gateway, auth, product, order, notification-worker | stateless | **ECS Fargate** (bậc 2: EKS) | orchestration, scaling, rolling deploy, service discovery |
| Postgres (`auth_db`,`product_db`,`order_db`) | stateful | **RDS** (1 instance, 3 database) | Multi-AZ, parameter group, connection limit, backup/snapshot, SSL |
| Redis | stateful | **ElastiCache** (`cache.t3.micro`) | cache managed, eviction policy |
| RabbitMQ | stateful | **Amazon MQ** (engine RabbitMQ) | broker HA, AMQPS/TLS |
| Email | external | **SES** (hoặc để mock như hiện tại) | — |

**Vì sao stateful KHÔNG để trong orchestrator (câu trả lời phỏng vấn):**
orchestrator có thể **giết & reschedule** container bất cứ lúc nào (deploy, health-check fail, scale, node chết).
Container stateless bị giết → vô hại, tạo lại. Postgres bị giết mà không gắn persistent volume đúng →
**mất sạch data**. Chạy Postgres trên EFS/NFS còn là anti-pattern (fsync qua network chậm/rủi ro).
→ Production **luôn** đẩy stateful ra managed service.

**Bài học bonus (bậc 2, EKS, nếu còn thời gian):** cố tình deploy Postgres bằng **StatefulSet + PVC (EBS CSI driver)**
để tận mắt thấy stateful trên k8s vận hành thế nào và *tại sao nó đau* → đối chiếu với RDS.
Kiểu hiểu "tôi biết làm, và biết vì sao production không làm thế" rất được đánh giá cao.

---

## 2. NGÀY 1 — Nền + hạ tầng stateful (managed)

> Mục tiêu cuối ngày: 5 image nằm trên ECR; RDS + ElastiCache + Amazon MQ đã "available" và lấy được endpoint; secrets đã nằm trong Secrets Manager. Chưa cần app chạy.

### 1.1 Chuẩn bị networking (dùng default VPC cho nhanh)
- Dùng **default VPC** của us-east-1 (đã có public subnet ở nhiều AZ).
- Tạo 3 security group:
  - `sg-alb`: inbound 80 (+443 nếu có cert) từ `0.0.0.0/0`.
  - `sg-app`: inbound 3000 từ `sg-alb`; inbound 50051–50053 từ **chính `sg-app`** (gRPC giữa các task); outbound all.
  - `sg-data`: inbound 5432 (RDS), 6379 (Redis), 5671 (Amazon MQ AMQPS) — **chỉ từ `sg-app`**.
- **Quyết định đơn giản hoá (có chủ đích):** đặt Fargate task ở **public subnet + assign public IP** để kéo image từ ECR mà **không cần NAT Gateway** (NAT ~$1/ngày + phí data — cắt được cho learning).
  - *Chuẩn production* sẽ là private subnet + NAT (hoặc VPC endpoint cho ECR/S3). Ghi lại như **hardening step** làm ở bậc 2, không làm ngày 1.

### 1.2 Push 5 image lên ECR
- Tạo 5 repo ECR: `api-gateway`, `auth-service`, `product-service`, `order-service`, `notification-worker`.
- Build **stage `production`** từng service (Dockerfile đã có sẵn, build từ ROOT repo):
  ```
  docker build -f services/<svc>/Dockerfile --target production -t <svc>:latest .
  ```
- `aws ecr get-login-password` → docker login → tag → push. *(Claude sẽ gen script `deploy/push-ecr.sh`.)*
- ⚠️ Mac Apple Silicon: build `--platform linux/amd64` vì Fargate mặc định x86_64 (nếu không sẽ `exec format error`).

### 1.3 Provision stateful (chạy song song trong lúc push image)
- **RDS Postgres** (`db.t3.micro`, engine 16): tạo 1 instance, sau đó tạo 3 database `auth_db`/`product_db`/`order_db`.
  - Đặt trong `sg-data`. Bật SSL (mặc định).
- **ElastiCache** (engine **Valkey** — tương thích Redis, `cache.t3.micro`, single node): tắt in-transit encryption cho đơn giản (dùng `redis://`).
- **Amazon MQ** (engine RabbitMQ, `mq.t3.micro`, single-instance): tạo user/pass → endpoint dạng `amqps://...:5671`.

### 1.4 Secrets Manager
- Lưu: `POSTGRES_PASSWORD`, `JWT_SECRET`, Amazon MQ user/pass, các `DATABASE_URL` hoàn chỉnh.
- Task definition sẽ tham chiếu secret qua ARN (không để plaintext trong env).

### ✅ Verify ngày 1
- `aws ecr list-images` thấy đủ 5 image.
- `psql` từ máy (tạm mở `sg-data` cho IP của bạn) vào RDS, `\l` thấy 3 database.
- Amazon MQ console → "Running"; ElastiCache → "available".

---

## 3. NGÀY 2 — Stateless + ghép nối (ECS Fargate)

> Mục tiêu cuối ngày: gọi `http://<ALB-DNS>/products` ra data; đăng ký/đăng nhập, đặt hàng chạy end-to-end; notification-worker nhận event.

### 2.1 Service discovery (Cloud Map)
- Tạo **private DNS namespace** `microservice.local`.
- Mỗi ECS service đăng ký → DNS `auth-service.microservice.local`, v.v.
- Set env cho task:
  - api-gateway: `AUTH_GRPC_URL=auth-service.microservice.local:50051`, `PRODUCT_GRPC_URL=product-service.microservice.local:50052`, `ORDER_GRPC_URL=order-service.microservice.local:50053`
  - order-service: `PRODUCT_GRPC_URL=product-service.microservice.local:50052`
- ⚠️ **gRPC bind:** giữ `GRPC_URL=0.0.0.0:5005x` (nghe mọi interface) như compose — nếu bind `localhost` thì task khác không gọi được.

### 2.2 Task definition + ECS service cho 5 app (Claude gen JSON)
- Mỗi service 1 task def (Fargate, 0.25 vCPU / 0.5 GB là đủ cho learning), env lấy từ `docker-compose.prod.yml`, secret từ Secrets Manager, log driver `awslogs` → CloudWatch.
- Tạo 5 ECS service (`desiredCount: 1`), đặt `sg-app`, public subnet, assignPublicIp ENABLED.
- **Thứ tự khởi động không quan trọng**: gRPC client của gateway nối *lười* (lazy, tới request đầu mới nối) — đã kiểm chứng khi chạy local.

### 2.3 ALB cho api-gateway (public)
- ALB ở `sg-alb`, target group **port 3000**, health check path **`/health`** (đã có `health.controller.ts`, nhớ `@SkipThrottle()`).
- Chỉ **api-gateway** gắn vào ALB. 4 service kia **không** public (đúng CLAUDE.md: chỉ api-gateway expose REST).

### 2.4 Migration + seed
- Migration TypeORM **không** tự chạy trên prod → chạy 1 lần: hoặc ECS **run-task** one-off (`npm run migration:run`), hoặc tạm từ máy qua bastion/mở SG.
- Seed: prod **không** set `SEED_ON_BOOT`. Nếu muốn data mẫu, chạy `npm run seed` như one-off task (seeder idempotent theo key nghiệp vụ — an toàn chạy lại).

### ✅ Verify ngày 2
- `curl http://<ALB-DNS>/health` → 200.
- `curl http://<ALB-DNS>/products` → list sản phẩm (chứng minh gateway→product gRPC + RDS OK).
- Đăng ký → login → nhận JWT (chứng minh auth + Redis refresh).
- `POST /orders` → tạo đơn, CloudWatch log notification-worker thấy event (chứng minh order→product gRPC + Amazon MQ).

---

## 4. Failure modes & gotchas (đây là phần "thịt" để trả lời phỏng vấn)

1. **RDS bắt SSL.** Postgres RDS thường force SSL → TypeORM cần bật `ssl` (vd `?sslmode=no-verify` hoặc `ssl: { rejectUnauthorized: false }` cho learning). Không bật → `connection terminated`/`no pg_hba.conf entry`.
2. **Amazon MQ dùng AMQPS (TLS, port 5671), không phải 5672.** URL đổi sang `amqps://user:pass@xxx.mq.us-east-1.amazonaws.com:5671`. `amqplib` hỗ trợ nhưng phải đúng scheme, sai là `ECONNREFUSED`/handshake fail.
3. **Image sai kiến trúc** (build trên Apple Silicon quên `--platform linux/amd64`) → task chết ngay với `exec format error`.
4. **gRPC service discovery**: quên đăng ký Cloud Map hoặc SG chặn 50051–53 giữa task → gateway timeout `DEADLINE_EXCEEDED` → HTTP 504 (checkStock có timeout mặc định 3s, cấu hình qua env `PRODUCT_GRPC_TIMEOUT_MS`).
5. **Fargate task không kéo được ECR** (thiếu public IP ở public subnet, hoặc thiếu NAT ở private subnet) → task stuck `PENDING`→`STOPPED`, lỗi `CannotPullContainerError`.
6. **Task role vs execution role** (dễ lẫn): *execution role* để ECS kéo image + đọc secret lúc khởi động; *task role* để code trong container gọi AWS SDK (SES). Gán nhầm → task không start hoặc SES `AccessDenied`.
7. **Cold start / health check quá gấp**: NestJS boot vài giây; nếu ALB health check interval/threshold quá ngắt → ALB kill task trước khi sẵn sàng, loop mãi. Nới `healthCheckGracePeriodSeconds`.

---

## 5. Lịch tổng 15 ngày AWS — đã cân đối (gồm Day 6 CI/CD, trừ Day 7 off-clock)

> Dựng lại hệ trên EKS ở bậc 2 → tập trung học *riêng* k8s primitives (app/networking đã hiểu từ bậc 1).
> **Day 7 (payment) KHÔNG có trong bảng này** — làm off-clock, xem §0b.

| Ngày | Việc | Học được / primitive | Nhóm |
|---|---|---|---|
| 1–2 | **Bậc 1 — ECS Fargate**: ECR, task def, Cloud Map, ALB, migration/seed, verify end-to-end | ECS core, service discovery, ALB | 🔴 Phải đáp đất |
| 3 | **Day 6 — CI/CD (ECS)**: GitHub Actions build→push ECR→`aws ecs update-service` (force new deployment) | pipeline, OIDC role, rolling deploy | 🔴 Phải đáp đất |
| 4 | Buffer/hardening ECS: vá chỗ sót, IAM, health-check grace, đọc lại CloudWatch log | debug thực chiến | 🔴 Phải đáp đất |
| 5–6 | **Bậc 2 — EKS**: `eksctl` tạo cluster; `Deployment`+`Service` (ClusterIP) 5 service; env qua `ConfigMap`/`Secret`; gRPC nội bộ qua **CoreDNS** (`*.svc.cluster.local`) | cluster, Deployment, Service, ConfigMap, Secret, DNS | 🟡 Stretch cao |
| 7 | EKS: expose api-gateway qua **Ingress** (AWS Load Balancer Controller) — so với ALB target group ở ECS | Ingress, IngressClass | 🟡 Stretch cao |
| 8 | EKS: nối RDS/ElastiCache/Amazon MQ (tái dùng bậc 1); `livenessProbe`/`readinessProbe` (`/health`); `resources` requests/limits | External Secret, probe, QoS | 🟡 Stretch cao |
| 9 | EKS: `HorizontalPodAutoscaler` + metrics-server; rolling update & rollback | HPA, rollout | 🟡 Stretch cao |
| 10 | **CI/CD mở rộng sang EKS**: `kubectl set image` (hoặc Helm) — delta nhỏ vì pipeline đã có | pipeline đa target | 🟡 Stretch cao |
| 11 | **Bonus stateful**: Postgres bằng `StatefulSet`+`PVC` (EBS CSI) → thấy vì sao đau → đối chiếu RDS | StatefulSet, PVC, StorageClass | 🟢 Nếu kịp |
| 12–13 | Buffer: hardening (private subnet + NAT / VPC endpoint), observability CloudWatch, viết **so sánh ECS↔EKS** cho phỏng vấn | production hardening | 🟢 Nếu kịp |
| 14–15 | Buffer cứng chống trượt / **teardown an toàn** / chốt CV notes | — | 🟢 Nếu kịp |

**Đọc bảng:** 🔴 (ngày 1–4) là tối thiểu phải xong — một hệ chạy được + CI/CD hoàn chỉnh, đủ kể chuyện phỏng vấn dù account chết sớm. 🟡 (5–10) là phần EKS giá trị cao. 🟢 là bonus. Người mới hay trượt lịch → buffer 12–15 là có chủ đích, đừng nhồi việc bắt buộc vào đó.

**Day 7 (payment mock) — off-clock:** dev local bằng `docker-compose` bất cứ lúc nào (tối, cuối tuần, hoặc sau khi AWS hết hạn). Gần chắc lặp lại pattern dual-write của order → cân nhắc gộp thẳng vào **phase 2 (transactional outbox)** thay vì làm riêng. Nếu bậc 2 xong sớm và account còn sống, deploy payment lên cloud chỉ là lặp pattern "thêm 1 service".

---

## 6. Cost watch & teardown (account chỉ còn $190/15 ngày)

- **Thủ phạm ngầm ăn tiền**: NAT Gateway (~$1/ngày + data — ta né bằng public subnet ở bậc 1), EKS control plane (~$0.10/h ≈ $2.4/ngày), ALB (~$0.55/ngày + LCU), RDS/ElastiCache/Amazon MQ chạy 24/7.
- **Quy tắc**: hết giờ học trong ngày → **stop RDS**, **xoá EKS node group** (hoặc scale về 0), **xoá ALB/Ingress** nếu không demo. Giữ ECR + Secrets (gần như free).
- Bật **AWS Budgets** cảnh báo ở $150 để không cháy quá tay.
- Xài `t3.micro`/`cache.t3.micro`/`db.t3.micro` xuyên suốt — đủ cho learning.

---

## 7. Điểm nói khi phỏng vấn (rút ra từ chính deploy này)

- "Vì sao tách stateful ra managed thay vì để trong ECS/k8s" → reschedule + mất data + EFS anti-pattern.
- "gRPC service discovery giữa service" → Cloud Map (ECS) vs CoreDNS (EKS).
- "api-gateway là điểm vào REST duy nhất, 4 service kia không public" → ALB chỉ gắn gateway, SG chặn nội bộ.
- "execution role vs task role", "ALB health check grace period", "AMQPS vs AMQP".
- "So sánh ECS và EKS": task definition vs manifest, service vs Deployment+Service, Cloud Map vs CoreDNS, ALB target group vs Ingress.

---

## 8. Checklist thực thi

**Ngày 1**
- [ ] AWS CLI đã `aws configure` (us-east-1) — *đã có*
- [ ] Tạo 5 ECR repo + push 5 image (`--platform linux/amd64`, target `production`)
- [ ] Tạo 3 security group (`sg-alb`/`sg-app`/`sg-data`)
- [ ] RDS Postgres + tạo 3 database
- [ ] ElastiCache Redis
- [ ] Amazon MQ (RabbitMQ)
- [ ] Đẩy secrets vào Secrets Manager

**Ngày 2**
- [ ] Cloud Map namespace `microservice.local`
- [ ] 5 task definition + 5 ECS service
- [ ] ALB + target group `/health` cho api-gateway
- [ ] Chạy migration (one-off task) + seed (optional)
- [ ] Verify end-to-end qua ALB DNS

**Ngày 3–4 (🔴 phải đáp đất)**
- [ ] Day 6 — CI/CD: GitHub Actions (OIDC role) → build → push ECR → `aws ecs update-service`
- [ ] Buffer/hardening ECS (IAM, health-check grace, đọc CloudWatch log)

**Ngày 5–15 (🟡/🟢 EKS + bonus + buffer)**: theo bảng §5.

**Off-clock (không tính ngày AWS)**
- [ ] Day 7 — payment mock: dev local `docker-compose`; cân nhắc gộp vào phase 2 outbox

---

> **Bước tiếp theo ngay**: Claude gen `deploy/push-ecr.sh` (tạo repo + build `linux/amd64` + push 5 image) và
> file env-template liệt kê mọi biến cần cho task definition. Bắt đầu từ 1.2.
