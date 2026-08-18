# E-commerce Microservices — Dự án 1 tuần (NestJS + Docker + AWS)

> Dự án tự học microservice, thiết kế để **xong trong 7 ngày** với sự hỗ trợ của **Claude Code CLI**,
> deploy lên **AWS chi phí thấp nhất có thể** (1 EC2, mọi thứ chạy container), có **CI/CD cả GitHub Actions lẫn AWS CodePipeline**.

**tách service, giao tiếp sync (gRPC) + async (RabbitMQ), chạy nhiều container, service discovery, và pipeline deploy multi-service**.

---

## 1. Tại sao chọn đề tài này

E-commerce là "câu chuyện microservice" mà nhà tuyển dụng nhận ra ngay. Nó tự nhiên chia thành các
service có ranh giới rõ ràng, và bắt buộc phải có cả giao tiếp đồng bộ lẫn bất đồng bộ — đúng những
điểm bạn cần bổ sung. Đủ nhỏ để 1 người làm xong trong 1 tuần, nhưng đủ "thật" để nói được trong phỏng vấn.

**Điểm nhấn để đưa vào CV sau khi hoàn thành:**
> Designed and deployed an e-commerce microservices system (5 services) on AWS with NestJS, using gRPC for
> synchronous inter-service communication and RabbitMQ for event-driven async workflows (order → payment →
> notification). Containerized with Docker, deployed to EC2, with dual CI/CD pipelines (GitHub Actions + AWS CodePipeline/CodeDeploy).

---

## 2. Kiến trúc hệ thống

```
                       ┌─────────────────────────────────────────────┐
   Client (HTTP/REST)  │                                             │
        │              │              AWS EC2 (t3.micro)              │
        ▼              │                                             │
  ┌───────────┐        │   ┌──────────────┐                          │
  │ API Gateway│◄──────┼───│ api-gateway  │  REST inbound            │
  │  (NestJS)  │        │   │  :3000       │                          │
  └─────┬─────┘        │   └──────┬───────┘                          │
        │ gRPC (sync)  │          │ gRPC (sync)                      │
        ├──────────────┼──────────┼──────────────┬─────────────┐     │
        ▼              │          ▼              ▼             ▼     │
  ┌───────────┐        │   ┌───────────┐  ┌───────────┐  ┌──────────┐│
  │auth-service│       │   │product-svc│  │order-svc  │  │          ││
  │  :50051   │        │   │  :50052   │  │  :50053   │  │          ││
  └─────┬─────┘        │   └─────┬─────┘  └─────┬─────┘  │          ││
        │              │         │              │ publish event      │
        │              │         │              ▼ (async)            │
        │              │         │        ┌──────────────┐           │
        │              │         │        │  RabbitMQ    │           │
        │              │         │        │  :5672       │           │
        │              │         │        └──────┬───────┘           │
        │              │         │               │ consume           │
        │              │         │               ▼                   │
        │              │         │        ┌──────────────────┐       │
        │              │         │        │ notification-worker│      │
        │              │         │        │ (email / mock SES) │      │
        │              │         │        └──────────────────┘       │
        ▼              │         ▼                                    │
  ┌──────────────────────────────────────────┐                       │
  │  PostgreSQL (1 container, DB riêng/service) │  + Redis (cache/JWT) │
  └──────────────────────────────────────────┘                       │
                       └─────────────────────────────────────────────┘
```

### Các service

| Service | Vai trò | Giao tiếp | DB |
|---|---|---|---|
| **api-gateway** | Nhận REST từ client, xác thực JWT, gọi các service qua gRPC, tổng hợp response | REST in, gRPC out | — |
| **auth-service** | Đăng ký/đăng nhập, phát hành & verify JWT, lưu refresh token ở Redis | gRPC | `auth_db` |
| **product-service** | CRUD sản phẩm, kiểm tra tồn kho | gRPC | `product_db` |
| **order-service** | Tạo đơn hàng, gọi product-service check stock (sync), publish `order.created` (async) | gRPC + publish RabbitMQ | `order_db` |
| **notification-worker** | Consume event `order.created`/`payment.succeeded`, gửi email (mock hoặc AWS SES) | consume RabbitMQ | — |

> **Vì sao chỉ 1 Postgres, mỗi service 1 database?** Đây là mẫu "database-per-service" phiên bản tiết kiệm:
> mỗi service sở hữu schema riêng (không service nào query DB của service khác), nhưng chạy chung 1 instance
> để tiết kiệm RAM/chi phí trên EC2 free tier. Trong CV bạn vẫn nói đúng "database-per-service".

### Luồng nghiệp vụ chính (thể hiện cả sync + async)

1. Client `POST /orders` → **api-gateway** verify JWT (gọi auth-service qua gRPC).
2. api-gateway → **order-service** (gRPC).
3. order-service → **product-service** (gRPC, **sync**) để kiểm tra tồn kho & giá.
4. order-service lưu đơn, rồi **publish event `order.created`** lên RabbitMQ (**async**).
5. **notification-worker** consume event → gửi email xác nhận (mock/SES).
6. (Mở rộng ngày 6) payment mock publish `payment.succeeded` → notification-worker gửi email lần 2.

---

## 3. Tech stack

- **Ngôn ngữ/Framework:** TypeScript, NestJS (microservices package)
- **Sync:** gRPC (`@nestjs/microservices` transport gRPC + protobuf)
- **Async:** RabbitMQ (`amqplib` / NestJS RMQ transport)
- **DB:** PostgreSQL (TypeORM/Prisma), Redis (cache + refresh token)
- **Container:** Docker + docker-compose (multi-stage build)
- **Cloud:** AWS EC2 (t3.micro), ECR (chứa image), SES (email, optional)
- **CI/CD:** GitHub Actions (build/test/push ECR + SSH deploy) **và** AWS CodePipeline + CodeBuild + CodeDeploy
- **Test:** Jest (unit + e2e) — bạn đã mạnh phần này, dùng để làm đầy pipeline

---

## 4. Roadmap 7 ngày

Mỗi ngày ~3-5 giờ. Cột "Prompt" trỏ tới bộ prompt sẵn trong `PROMPTS.md` để dùng với Claude Code CLI.

### Ngày 1 — Nền móng monorepo + local chạy được
- [ ] Khởi tạo monorepo (Nx hoặc pnpm workspaces — file mẫu dùng cấu trúc thư mục đơn giản).
- [ ] Dựng `docker-compose.yml`: postgres, redis, rabbitmq (đã có sẵn trong repo này).
- [ ] Tạo skeleton 2 service đầu: `api-gateway` (REST) + `auth-service` (gRPC).
- [ ] Định nghĩa file protobuf `auth.proto`.
- [ ] Chạy `docker compose up`, gọi thử 1 endpoint health.
- **Mục tiêu:** local lên được, gateway gọi auth-service qua gRPC trả về "pong".
- **Prompt:** `PROMPTS.md` → Day 1

### Ngày 2 — Auth service hoàn chỉnh (gRPC sync)
- [ ] `auth-service`: register/login, hash mật khẩu (bcrypt/argon2), phát JWT.
- [ ] Lưu refresh token vào Redis, verify token qua gRPC.
- [ ] `api-gateway`: guard verify JWT bằng cách gọi auth-service.
- [ ] Viết vài unit test cho auth logic.
- **Mục tiêu:** đăng ký → đăng nhập → gọi endpoint cần auth thành công.
- **Prompt:** `PROMPTS.md` → Day 2

### Ngày 3 — Product service (gRPC sync)
- [ ] `product-service`: CRUD product + endpoint `checkStock`.
- [ ] `product.proto`, kết nối `product_db`.
- [ ] api-gateway expose `/products` REST → gọi product-service gRPC.
- [ ] Seed vài sản phẩm mẫu — đặt ở `src/database/seeds/`, tự chạy khi boot nếu `SEED_ON_BOOT=true` (compose dev đã bật), hoặc chạy tay `docker compose exec product-service npm run seed`.
- **Mục tiêu:** CRUD sản phẩm qua gateway hoạt động.
- **Prompt:** `PROMPTS.md` → Day 3

### Ngày 4 — Order service + RabbitMQ (async — phần quan trọng nhất)
- [ ] `order-service`: tạo order, gọi product-service `checkStock` (gRPC sync).
- [ ] Setup RabbitMQ, order-service **publish** `order.created`.
- [ ] `notification-worker`: **consume** `order.created`, log/gửi email mock.
- [ ] Xử lý retry / dead-letter cơ bản.
- **Mục tiêu:** đặt hàng → thấy event chạy qua queue → worker nhận & xử lý.
- **Prompt:** `PROMPTS.md` → Day 4

### Ngày 5+ — Deploy lên AWS ⚠️ ĐÃ PIVOT

> Kế hoạch cũ (1 EC2 + `docker-compose`) **đã thay** bằng **ECS Fargate → EKS**.
> Kế hoạch mới: [`note/next-plan.md`](note/next-plan.md). Bản cũ giữ ở `infra/legacy-ec2/`.
>
> Lý do: budget không còn là ràng buộc ($190/15 ngày), mục tiêu chuyển sang học-để-phỏng-vấn
> → deploy bằng orchestrator (thứ ngành thực sự dùng), không phải `docker-compose` trên 1 EC2.

Mỗi bậc có **2 bản hướng dẫn**: `CONSOLE_GUIDE.md` (bấm chuột, dùng khi học lần đầu) và
script CLI (dựng lại nhanh / cắm vào CI/CD).

| Ngày | Việc | Hướng dẫn |
|---|---|---|
| 1 | Hạ tầng chung: SG, ECR, RDS, ElastiCache, Amazon MQ, Secrets Manager | [`infra/common/`](infra/common/) |
| 2 | **Bậc 1 — ECS Fargate**: task def, Cloud Map, ALB, migration/seed | [`infra/ecs-fargate/`](infra/ecs-fargate/) |
| 3 | **CI/CD** (Day 6 cũ): GitHub Actions OIDC → ECR → ECS | [`cicd/`](cicd/) |
| 4 | Buffer / hardening ECS | — |
| 5–11 | **Bậc 2 — EKS**: Deployment, Service, Ingress, probe, HPA, StatefulSet | [`infra/eks/`](infra/eks/) |
| 12–15 | Buffer, so sánh ECS↔EKS cho phỏng vấn, teardown an toàn | [`infra/common/COST_PLAN.md`](infra/common/COST_PLAN.md) |

**Day 7 (payment mock) ra khỏi đường găng AWS** — dev local bằng `docker-compose` bất cứ lúc nào,
cân nhắc gộp thẳng vào phase 2 (transactional outbox).

### Ngày 7 — Payment mock, hoàn thiện, tài liệu, README cho recruiter
- [ ] Thêm luồng payment mock (publish `payment.succeeded`).
- [ ] Viết README dự án đẹp (kiến trúc, cách chạy, screenshot).
- [ ] Thêm health check + graceful shutdown cho từng service.
- [ ] Vẽ sơ đồ kiến trúc (dùng lại sơ đồ trong file này).
- [ ] Viết đoạn mô tả để thêm vào CV/LinkedIn.
- [ ] **Quan trọng: stop/terminate EC2 khi không dùng.** Tài khoản cũ: tránh vượt 750h/tháng.
      Tài khoản tạo từ 15/07/2025: mỗi giờ chạy đều trừ vào $200 credit, và Free plan hết hạn sau
      6 tháng thì **AWS đóng tài khoản** — quyết định upgrade lên Paid plan trước khi tới hạn.
- **Prompt:** `PROMPTS.md` → Day 7

---

## 5. Chi phí AWS — làm sao để rẻ nhất

> ⚠️ **AWS đổi Free Tier từ 15/07/2025.** Quyền lợi phụ thuộc **ngày tạo tài khoản**:
>
> | | Tạo **trước** 15/07/2025 | Tạo **từ** 15/07/2025 |
> |---|---|---|
> | Thời hạn | 12 tháng | **6 tháng** hoặc hết credit |
> | Hạn mức EC2 | 750 giờ/tháng miễn phí | **$100 credit** + tối đa $100 thưởng; **không có 750 giờ riêng**, giờ chạy trừ vào credit |
> | Instance eligible | `t2.micro`, `t3.micro` | `t3.micro`, `t3.small`, `t4g.micro`, `t4g.small`, `c7i-flex.large`, `m7i-flex.large` |
> | Hết hạn | Tính tiền pay-as-you-go | Còn ở Free plan ⇒ **AWS đóng tài khoản** (giữ data 90 ngày) |
>
> Tài khoản mới **không còn "$0 vô thời hạn"** — ngân sách thật là $200 credit / 6 tháng.
> Chi tiết + cách kiểm tra tài khoản mình thuộc nhóm nào: `infra/legacy-ec2/AWS_SETUP.md` mục 0.
> Ngân sách & teardown cho kế hoạch hiện tại: `infra/common/COST_PLAN.md`.

| Hạng mục | Free tier | Ngoài free tier (ước tính) | Cách tiết kiệm |
|---|---|---|---|
| **EC2 t3.micro** | 750 giờ/tháng (tk cũ) — hoặc trừ credit (tk mới) | ~$7.5/tháng | Chạy 1 instance, **stop khi không demo** |
| **EBS (ổ đĩa)** | 30 GB | ~$0.08/GB | Dùng ~20GB |
| **ECR** | 500 MB lưu trữ, 12 tháng | ~$0.10/GB | Lifecycle policy giữ ~3 image/repo |
| **Data transfer** | 100 GB out/tháng | $0.09/GB | Demo nhỏ không lo |
| **CodeBuild** | 100 phút build/tháng | ~$0.005/phút | Build nhẹ |
| **CodePipeline** | 1 pipeline miễn phí/tháng | $1/pipeline active | Chỉ tạo 1 pipeline |
| **SES** | 3.000 email/tháng (từ EC2) | $0.10/1000 email | Hoặc mock, không cần SES thật |
| **RabbitMQ/Postgres/Redis** | Chạy **container trên EC2**, KHÔNG dùng RDS/MQ managed | — | Đây là mấu chốt tiết kiệm |

**Nguyên tắc vàng để chi phí thấp nhất:**
1. **KHÔNG dùng RDS, ElastiCache, Amazon MQ, ECS Fargate** — tất cả chạy container trên chính EC2.
2. Chỉ **1 EC2 t3.micro**. RAM 1GB hơi chật cho 5 service + 3 hạ tầng → xem mục tối ưu RAM bên dưới.
3. **Stop EC2** khi không cần (chỉ tính tiền EBS ~vài cent/ngày). Với tài khoản mới, stop = ngừng đốt credit.
4. Đặt **billing alert $1** trong AWS Budgets ngay từ đầu — tài khoản mới còn được $20 credit cho việc này.
5. Xóa ECR image cũ định kỳ. Từ 01/2026 ECR dedupe layer trên toàn registry nên 5 service dùng chung
   `node:24-alpine` chỉ tốn dung lượng base **1 lần**.

### Lưu ý RAM (t3.micro chỉ 1GB)
5 service NestJS + Postgres + Redis + RabbitMQ có thể vượt 1GB. Cách xử lý:
- Bật **swap 2GB** trên EC2 (đã có trong `ec2-userdata.sh`).
- Giới hạn `mem_limit` cho từng container trong `docker-compose.prod.yml`.
- Nếu vẫn chật: gộp notification-worker vào chung tiến trình, hoặc dùng **t3.small** — với tài khoản
  tạo từ 15/07/2025 thì t3.small **cũng free-tier eligible** (chỉ tốn credit nhanh hơn); tài khoản cũ
  thì t3.small nằm ngoài free tier (~$15/tháng), chỉ bật lúc demo rồi stop.

> `t4g.micro`/`t4g.small` rẻ hơn nhưng là **Graviton (arm64)** — phải build image `linux/arm64`
> bằng `docker buildx`. Repo này mặc định x86_64, chọn t4g thì phải sửa cả CI.

---

## 6. Cách chạy local

Cần cài trước (cả 2 hệ điều hành): **Docker** (chạy container), **Node 24** (để dev/test service), **Git**, và **Claude Code CLI** (để sinh code theo `PROMPTS.md`).

### macOS

1. Cài **Docker Desktop for Mac** (chọn đúng chip: Apple Silicon M1/M2/M3 hay Intel).
2. Cài Node 24 + git — gợi ý dùng Homebrew:
   ```bash
   brew install node@24 git
   ```
3. Mở Terminal, `cd` vào thư mục dự án, chạy các bước chung bên dưới.

> Trên Apple Silicon, các image trong dự án (`postgres`, `redis`, `rabbitmq`, `node:24-alpine`) đều có bản arm64 nên chạy native, không cần chỉnh gì.

### Windows (dùng WSL2 — khuyến nghị)

Nên làm **bên trong WSL2 (Ubuntu)** để môi trường đồng nhất với Linux (giống EC2) và tránh lỗi vặt.

1. Cài **WSL2 + Ubuntu**: mở PowerShell (admin) chạy `wsl --install -d Ubuntu`, khởi động lại máy.
2. Cài **Docker Desktop for Windows**, bật backend WSL2 (Settings → General → *Use WSL 2 based engine*; và trong Resources → WSL Integration bật cho Ubuntu).
3. Mở terminal **Ubuntu**, cài Node 24 + git:
   ```bash
   sudo apt update && sudo apt install -y git
   curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt install -y nodejs
   ```
4. Cài Claude Code CLI **bên trong WSL**, và đặt/clone dự án trong filesystem của WSL (ví dụ `~/projects/`), **KHÔNG** để ở `/mnt/c/...` — I/O của Docker nhanh hơn nhiều.
5. `cd` vào thư mục dự án trong terminal Ubuntu, chạy các bước chung bên dưới.

Lưu ý Windows:
- File `.sh` đã được ép **LF** qua `.gitattributes`, nên script mount vào container không bị lỗi CRLF.
- Nếu lỡ chỉnh file `.sh` bằng editor Windows và bị CRLF: chạy `sed -i 's/\r$//' path/to/file.sh` trong WSL để sửa.
- Các script `ec2-userdata.sh`, `init-multiple-dbs.sh`, script CodeDeploy chạy **trên EC2 (Linux)** — HĐH máy bạn không ảnh hưởng.

### Các bước chung (macOS + Windows/WSL2)

Chạy trong Terminal (macOS) hoặc terminal Ubuntu (Windows/WSL2):

```bash
# 1. Dựng hạ tầng + service
cp .env.example .env
docker compose up -d --build

# 2. Kiểm tra
curl http://localhost:3000/health

# 3. Đăng ký + đăng nhập
curl -X POST http://localhost:3000/auth/register -d '{"email":"a@b.com","password":"12345678"}' -H 'Content-Type: application/json'
curl -X POST http://localhost:3000/auth/login    -d '{"email":"a@b.com","password":"12345678"}' -H 'Content-Type: application/json'

# Dừng / dọn dẹp
docker compose down          # dừng
docker compose down -v       # dừng + xóa data (Postgres/Redis)
```

RabbitMQ UI: http://localhost:15672 (guest/guest). Xem chi tiết từng bước trong `PROMPTS.md` (build bằng Claude Code CLI), `infra/README.md` (deploy lên AWS: ECS Fargate → EKS), `cicd/README.md` (CI/CD).

---

## 7. Cấu trúc thư mục repo

```
nestjs-microservice/
├── README.md                     # file này
├── CLAUDE.md                     # định hướng cho Claude Code CLI
├── PROMPTS.md                    # bộ prompt sẵn theo từng ngày
├── docker-compose.yml            # local dev
├── docker-compose.prod.yml       # chạy trên EC2 (pull image từ ECR)
├── .env.example
├── proto/                        # protobuf dùng chung
│   ├── auth.proto
│   ├── product.proto
│   └── order.proto
├── services/
│   ├── api-gateway/
│   │   └── Dockerfile
│   ├── auth-service/
│   │   └── Dockerfile
│   ├── product-service/
│   ├── order-service/
│   └── notification-worker/
├── infra/
│   ├── AWS_SETUP.md
│   ├── ec2-userdata.sh           # user-data khi tạo EC2 (docker, compose, CodeDeploy agent, swap)
│   ├── deploy-to-ec2.sh          # deploy tay: scp config + login ECR + compose up
│   └── init-multiple-dbs.sh
└── cicd/
    ├── CICD_SETUP.md
    ├── github-actions/
    │   ├── ci.yml
    │   └── deploy.yml
    └── aws/
        ├── buildspec.yml
        ├── appspec.yml
        └── scripts/
            ├── install.sh
            ├── start.sh
            └── stop.sh
```

> Các file NestJS bên trong mỗi service sẽ do **bạn + Claude Code CLI sinh ra** theo prompt từng ngày.
> Repo này cung cấp sẵn phần hạ tầng/DevOps (phần khó và tốn thời gian nhất) + Dockerfile mẫu + protobuf mẫu.
