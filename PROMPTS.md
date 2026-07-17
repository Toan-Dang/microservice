# PROMPTS.md — Bộ prompt sẵn cho Claude Code CLI

> Chạy `claude` trong thư mục repo. Dán từng prompt theo ngày. Prompt viết để Claude Code tự sinh code khớp
> với `CLAUDE.md` và các file `proto/*`. Sau mỗi bước, chạy `docker compose up -d --build` để kiểm tra.

**Mẹo dùng Claude Code CLI:**
- Làm từng service một, đừng yêu cầu sinh cả 5 service cùng lúc — dễ sai và khó review.
- Sau khi sinh code, luôn yêu cầu: "chạy `npm run build` và sửa lỗi TypeScript nếu có".
- Dùng `/clear` giữa các ngày để giữ context gọn.
- Yêu cầu Claude giải thích **tại sao** thay vì chỉ code — để bạn học, không chỉ có sản phẩm.

---

## DAY 1 — Nền móng

```
Đọc CLAUDE.md và proto/. Tạo cấu trúc monorepo dùng pnpm workspaces (hoặc npm workspaces nếu đơn giản hơn).
Scaffold 2 service NestJS: services/api-gateway và services/auth-service.

- api-gateway: NestJS HTTP app, port 3000, có endpoint GET /health trả {status:'ok'}.
  Cấu hình gRPC client tới auth-service dựa trên proto/auth.proto (env AUTH_GRPC_URL).
  Thêm endpoint GET /auth/ping gọi thử auth-service qua gRPC.
- auth-service: NestJS microservice gRPC (KHÔNG mở HTTP), listen theo env GRPC_URL, implement proto AuthService
  nhưng bước này chỉ cần method trả về giá trị giả để test kết nối.

Mỗi service có package.json với script start:dev/build/test/lint, tsconfig, và copy Dockerfile mẫu
(services/api-gateway/Dockerfile) sang, đổi SERVICE_DIR cho đúng.
Cuối cùng chạy `docker compose up -d --build` và sửa mọi lỗi cho tới khi GET /health và /auth/ping hoạt động.
```

---

## DAY 2 — Auth service hoàn chỉnh

```
Hoàn thiện auth-service theo proto/auth.proto:
- Entity User (id uuid, email unique, passwordHash, createdAt) qua TypeORM, kết nối DATABASE_URL (auth_db).
- Register: validate email/password, hash bằng bcrypt, lưu user, trả access_token + refresh_token (JWT).
- Login: kiểm tra credential, phát token.
- ValidateToken: verify access_token, trả valid + user_id + email.
- RefreshToken: kiểm refresh token lưu trong Redis (REDIS_URL), phát access token mới.
- JWT dùng JWT_SECRET, access 15m, refresh 7d.

Ở api-gateway:
- Thêm REST: POST /auth/register, POST /auth/login, POST /auth/refresh (map sang gRPC).
- Tạo JwtAuthGuard gọi ValidateToken của auth-service để bảo vệ route.

Viết unit test cho auth logic (hash, token). Chạy build + test, sửa tới khi pass.
Sau đó test bằng curl register → login → gọi 1 route được bảo vệ.
```

---

## DAY 3 — Product service

```
Scaffold services/product-service (gRPC, proto/product.proto), DB product_db.
- Entity Product (id, name, price, stock).
- Implement Create, FindOne, FindMany (phân trang), CheckStock (trả available/price/remaining).
- Seed 5 sản phẩm mẫu khi khởi động nếu bảng rỗng.

api-gateway: thêm REST /products (GET list, GET :id, POST create — POST cần JwtAuthGuard) map sang gRPC.
Cập nhật docker-compose đã có sẵn service product-service.
Chạy build + vài unit test cho CheckStock. Test qua curl.
```

---

## DAY 4 — Order service + RabbitMQ (async — trọng tâm)

```
Scaffold services/order-service (gRPC proto/order.proto, DB order_db) và services/notification-worker (RMQ consumer).

order-service:
- CreateOrder: với mỗi item gọi product-service.CheckStock qua gRPC (SYNC). Nếu thiếu hàng -> lỗi.
  Tính total, lưu Order (status PENDING), rồi PUBLISH event "order.created" lên RabbitMQ (RABBITMQ_URL)
  với payload {orderId, userId, items, total, email}. Dùng exchange 'orders' (topic) routing key 'order.created'.
- FindOne, FindByUser.

notification-worker:
- Kết nối RabbitMQ, subscribe 'order.created'. Khi nhận -> log + gửi email xác nhận.
  Nếu SES_FROM_EMAIL rỗng thì mock (chỉ console.log 'Email sent to ...'), ngược lại gửi qua AWS SES.
- Cấu hình dead-letter queue + retry cơ bản (requeue tối đa 3 lần).

api-gateway: POST /orders (JwtAuthGuard) map sang order-service.CreateOrder; GET /orders (của user hiện tại).

Chạy build + test. Demo: đăng nhập -> tạo order -> xem log worker nhận event. Mở RabbitMQ UI localhost:15672 để thấy queue.
```

---

## DAY 5 — Deploy AWS
Không cần Claude Code nhiều. Làm theo `infra/AWS_SETUP.md`. Có thể nhờ Claude Code:
```
Viết script scp copy docker-compose.prod.yml, infra/init-multiple-dbs.sh và .env lên EC2 host $EC2_IP,
rồi SSH chạy docker login ECR + docker compose -f docker-compose.prod.yml up -d. Đọc tham số từ biến môi trường.
```

---

## DAY 6 — CI/CD
Làm theo `cicd/CICD_SETUP.md`. Nhờ Claude Code kiểm tra file:
```
Đọc cicd/github-actions/*.yml và cicd/aws/* . Kiểm tra tính đúng đắn, chỉ ra IAM permission còn thiếu,
và điều chỉnh path nếu cấu trúc repo của tôi khác. Giải thích luồng chạy của mỗi pipeline.
```

---

## DAY 7 — Payment mock + hoàn thiện + README

```
1. Thêm payment mock: trong order-service (hoặc 1 module nhỏ) sau khi tạo order, sau 2s publish
   "payment.succeeded" (mô phỏng thanh toán thành công) -> notification-worker gửi email thứ 2 và cập nhật
   order status = PAID. Đây là mô phỏng, không tích hợp Stripe thật.
2. Thêm graceful shutdown (enableShutdownHooks) và GET /health cho api-gateway kiểm tra kết nối downstream.
3. Sinh README.md cấp dự án cho recruiter: mô tả, sơ đồ kiến trúc (ASCII), tech stack, cách chạy local,
   cách deploy, ảnh chụp màn hình placeholder, và phần "What I learned".
4. Rà soát toàn bộ: build tất cả service, chạy test, đảm bảo docker compose up sạch sẽ.
```

---

## Sau khi xong — mô tả để thêm vào CV
```
E-commerce Microservices (Personal) — NestJS, gRPC, RabbitMQ, Docker, AWS
- Built 5 independent microservices (gateway, auth, product, order, notification) with database-per-service.
- Synchronous inter-service calls via gRPC; event-driven async workflow (order → payment → notification) via RabbitMQ with retry & dead-letter handling.
- Containerized with multi-stage Docker builds; deployed to AWS EC2 (cost-optimized, free tier) with images on ECR.
- Dual CI/CD: GitHub Actions (test/build/push via OIDC) and AWS CodePipeline + CodeBuild + CodeDeploy.
```
