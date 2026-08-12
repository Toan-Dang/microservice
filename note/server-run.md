# server-run.md — Điều gì xảy ra khi bật server (thứ tự file chạy)

> File này trả lời câu hỏi: **"Khi tôi gõ `docker compose up`, những file nào chạy, theo thứ tự nào, cho tới lúc server sẵn sàng nhận request?"**
> Đọc kèm `note/day 2.md`, `note/day 3.md`, `note/day 4.md` (mục 3 của các file đó nói về flow *sau khi* server đã chạy — tức khi có request tới; file này nói về giai đoạn *khởi động*, trước khi có request nào).
> *(Cập nhật Day 3: thêm **product-service** vào Lớp 2 — xem Mục 1b. Cập nhật Day 4: thêm **order-service** — Mục 1c — và **notification-worker** — Mục 1d; RabbitMQ từ đây được dùng thật.)*
>
> Bạn quen monolith: chỉ 1 process, `main.ts` → `app.listen(3000)` là xong. Ở đây có **nhiều process độc lập** khởi động song song, mỗi cái có trình tự riêng, và có thứ tự phụ thuộc giữa chúng (DB phải sống trước khi service kết nối).

---

## 0. Bức tranh tổng — `docker compose up` khởi động theo lớp

`docker-compose.yml` khai báo `depends_on` + `healthcheck`, nên Docker **không** bật tất cả cùng lúc mà theo thứ tự phụ thuộc:

```
      docker compose up -d
              │
   ┌──────────┴───────────── LỚP 1: HẠ TẦNG (không phải code của bạn) ─────────────┐
   │                                                                                │
   ▼                          ▼                              ▼                       │
🗄 postgres                🔴 redis                     🐰 rabbitmq                   │
(chạy init-multiple-dbs.sh   (sẵn sàng ngay)             (Day 4 dùng thật:            │
 nếu volume MỚI → tạo                                     exchange 'orders')          │
 auth_db/product_db/order_db)                                                        │
   │  healthcheck: pg_isready   │ redis-cli ping    │ rabbitmq-diagnostics ping       │
   │  → tới khi "healthy"       │ → "healthy"        │ → "healthy"                     │
   └──────────┬─────────────────┴────────────────────┘                                │
              │  (compose CHỜ hạ tầng healthy rồi mới bật service)                     │
   ┌──────────┴───────────────── LỚP 2: SERVICE CODE ─────────────────────────────┐  │
   │                                                                               │  │
   ▼              ▼                    ▼                         ▼                 │  │
🟦 auth-service  🟪 product-service  🟧 order-service       🟩 api-gateway (:3000) │  │
   (gRPC :50051)   (gRPC :50052)       (gRPC :50053)          depends_on:          │  │
   depends_on:     depends_on:         depends_on:              auth(started),      │  │
     postgres,       postgres          postgres(healthy),       product(started),   │  │
     redis          → MỤC 1b           rabbitmq(healthy)        redis(healthy)      │  │
   → MỤC 1        (bỏ Jwt/Redis,     → MỤC 1c               → MỤC 2                │  │
                   thêm SEED)         (gọi product +                                │  │
                                       publish RMQ)                                 │  │
   │                                                                               │  │
   │   🟨 notification-worker  (KHÔNG cổng) — depends_on: rabbitmq(healthy) → MỤC 1d │  │
   └───────────────────────────────────────────────────────────────────────────────┘  │
                                                                                        │
```

**Ý quan trọng:** `api-gateway` chỉ `depends_on: ... (service_started)` — tức chỉ chờ *process* auth-service/product-service bật, **không** chờ chúng "sẵn sàng logic". Đây là lý do gRPC client của gateway **kết nối lười (lazy)**: nó không nối tới các service lúc boot, mà tới **request đầu tiên** mới nối. Nhờ vậy thứ tự bật giữa các service không gây crash.

---

## 1. Bên trong auth-service khởi động (process gRPC, KHÔNG có HTTP)

Lệnh chạy: dev = `npm run start:dev` (`nest start --watch`) ; prod = `node dist/main.js`. Cả 2 đều bắt đầu từ `main.ts`.

```
📄 services/auth-service/src/main.ts   ── ĐIỂM VÀO (chạy ĐẦU TIÊN)
   │  bootstrap()
   │
   ├─[a] getProtoPath('auth.proto')  ─► 📄 common/proto-path.util.ts
   │        (tìm đường dẫn file proto, khác nhau dev/prod)
   │
   ├─[b] NestFactory.createMicroservice(AppModule, { transport: GRPC, ... })
   │        │  ❗ createMicroservice (KHÔNG phải create) → app này không mở cổng HTTP
   │        ▼
   │   📄 services/auth-service/src/app.module.ts   ── Nest đọc metadata, khởi tạo các module
   │        theo thứ tự phụ thuộc (depth-first):
   │
   │     (1) ConfigModule.forRoot({isGlobal})   → đọc biến môi trường (DATABASE_URL,
   │                                               JWT_SECRET, REDIS_URL, GRPC_URL...)
   │
   │     (2) TypeOrmModule.forRootAsync(...)     → useFactory chạy:
   │           ├─ đọc DATABASE_URL từ ConfigService
   │           ├─ 🔌 MỞ KẾT NỐI tới Postgres (auth_db)   ═══TCP═══► 🗄 postgres
   │           ├─ nạp entity 📄 auth/user.entity.ts
   │           └─ migrationsRun:true → CHẠY migration đang chờ:
   │                   📄 migrations/<timestamp>-InitAuth.ts (hàm up())
   │                   → tạo bảng "users" nếu chưa có + ghi vào bảng "migrations"
   │                   (đã chạy rồi thì bỏ qua — idempotent)
   │
   │     (3) TypeOrmModule.forFeature([User])    → tạo Repository<User> để inject
   │
   │     (4) JwtModule.registerAsync(...)        → useFactory đọc JWT_SECRET, tạo JwtService
   │
   │     (5) providers của AppModule:
   │           📄 redis/redis.service.ts  → new RedisService(config)
   │                   └─ constructor 🔌 MỞ KẾT NỐI Redis (REDIS_URL) ═══TCP═══► 🔴 redis
   │           📄 auth/auth.service.ts    → new AuthService(usersRepo, jwt, redis, config)
   │                   (Dependency Injection ráp 4 thứ trên vào — GIỐNG monolith)
   │
   │     (6) controllers của AppModule:
   │           📄 auth/auth.controller.ts → new AuthController(authService)
   │                   → Nest đăng ký 4 @GrpcMethod (Register/Login/ValidateToken/RefreshToken)
   │                     ánh xạ tên rpc trong proto → hàm TS tương ứng
   │
   ├─[c] app.enableShutdownHooks()   → bật lắng nghe SIGTERM/SIGINT để khi tắt container
   │        gọi onModuleDestroy (📄 redis.service.ts → redis.quit() đóng kết nối sạch)
   │
   └─[d] await app.listen()          → 🚀 gRPC server BIND cổng 50051, bắt đầu nhận request
            (từ giờ auth-service sẵn sàng — flow ở day 2 mục 3 mới bắt đầu chạy được)
```

**File KHÔNG chạy lúc boot auth-service:**
- `data-source.ts` — chỉ chạy khi gõ lệnh `npm run migration:*` (CLI), không phải khi server bật.
- `auth/auth.service.spec.ts` — chỉ chạy khi `npm test`.
- `auth/auth.interface.ts` — chỉ là type TypeScript, biến mất sau khi biên dịch (không có runtime).

---

## 1b. Bên trong product-service khởi động (Day 3 — gần giống auth-service)

Trình tự **y hệt Mục 1**, chỉ khác 3 điểm. Bắt đầu từ `📄 services/product-service/src/main.ts`:

```
📄 main.ts → createMicroservice(AppModule, { GRPC, package:'product', url :50052 })
   │
   ▼
📄 app.module.ts   ── Nest khởi tạo module:
     (1) ConfigModule.forRoot({isGlobal})     → đọc DATABASE_URL, GRPC_URL
     (2) TypeOrmModule.forRootAsync(...)       → MỞ KẾT NỐI ═══TCP═══► 🗄 postgres (product_db)
           └─ migrationsRun:true → chạy 📄 migrations/<ts>-InitProduct.ts (tạo bảng "products")
     (3) TypeOrmModule.forFeature([Product])   → tạo Repository<Product>
     (4) providers: 📄 product/product.service.ts   (❗ KHÔNG có JwtModule, KHÔNG có RedisService)
     (5) controllers: 📄 product/product.controller.ts → đăng ký 4 @GrpcMethod
                       (Create / FindOne / FindMany / CheckStock)
   │
   ├─ 🌱 LIFECYCLE HOOK OnApplicationBootstrap  (chạy SAU khi module init + migration xong):
   │      📄 database/seeds/seed.module.ts → onApplicationBootstrap():
   │         if (SEED_ON_BOOT !== 'true') return                    (prod không set → bỏ qua)
   │         runSeeders() → 📄 product.seeder.ts: chèn sản phẩm mẫu CÒN THIẾU (idempotent theo `name`)
   │         └─► 🗄 product_db   (đã có → bỏ qua từng bản ghi, restart không nhân đôi)
   │
   ├─ app.enableShutdownHooks()
   └─ await app.listen()   → 🚀 gRPC BIND :50052  ✅ product-service READY
```

**3 khác biệt so với auth-service (Mục 1):**
- Kết nối `product_db` (không phải `auth_db`) — **DB tách hẳn**, database-per-service.
- **Không** `JwtModule`/`RedisService` (product không lo token/redis).
- Có thêm **`SeedModule`** chạy ở `OnApplicationBootstrap` — chỉ khi `SEED_ON_BOOT=true`, idempotent theo từng bản ghi (xem Day 3 mục 6.1).

> Log để nhận ra seed đã chạy: dòng `seed "products": thêm 5, bỏ qua 0`. Restart lần sau in `thêm 0, bỏ qua 5` (idempotent).

---

## 1c. Bên trong order-service khởi động (Day 4 — service đầu tiên vừa gọi service khác, vừa nối broker)

Bắt đầu từ `📄 services/order-service/src/main.ts` (createMicroservice, package `'order'`, cổng `:50053`):

```
📄 main.ts → createMicroservice(AppModule, { GRPC, package:'order', url :50053 })
   │
   ▼
📄 app.module.ts   ── Nest khởi tạo module:
     (1) ConfigModule.forRoot({isGlobal})     → đọc DATABASE_URL, GRPC_URL, PRODUCT_GRPC_URL, RABBITMQ_URL
     (2) TypeOrmModule.forRootAsync(...)       → MỞ KẾT NỐI ═══TCP═══► 🗄 postgres (order_db)
           └─ migrationsRun:true → chạy 📄 migrations/<ts>-InitOrder.ts (tạo bảng "orders" + index user_id)
     (3) TypeOrmModule.forFeature([Order])     → tạo Repository<Order>
     (4) ProductClientModule                   → ClientsModule.registerAsync ClientGrpc tới :50052
           📄 product-client.service.ts        → onModuleInit: getService('ProductService') (proxy, LAZY — chưa nối)
     (5) MessagingModule                        → provider 📄 messaging/rabbitmq.publisher.ts
           └─ 🌱 OnModuleInit: 🔌 amqp.connect(RABBITMQ_URL) ═══TCP═══► 🐰 rabbitmq
                 + assertExchange('orders','topic')   (lỗi lúc này chỉ log, publish sau sẽ reconnect)
     (6) controllers: 📄 order/order.controller.ts → đăng ký 3 @GrpcMethod (CreateOrder/FindOne/FindByUser)
   │
   ├─ app.enableShutdownHooks()   → khi tắt: publisher đóng channel + connection RabbitMQ sạch
   └─ await app.listen()   → 🚀 gRPC BIND :50053  ✅ order-service READY
```

**Khác product-service (Mục 1b):** nối `order_db`; **thêm** 2 thứ — proxy gRPC tới product-service (lazy, cho `CheckStock`) và **kết nối RabbitMQ ngay lúc boot** để sẵn sàng publish. Không có seed.

> Log nhận ra đã sẵn sàng: `[RabbitmqPublisher] Đã kết nối RabbitMQ, exchange 'orders' (topic) sẵn sàng` rồi `Nest microservice successfully started`.

---

## 1d. Bên trong notification-worker khởi động (Day 4 — process KHÔNG cổng, chỉ consume)

`📄 services/notification-worker/src/main.ts` dùng **`createApplicationContext`** — không mở HTTP cũng không gRPC; chỉ dựng DI rồi để consumer tự kéo message.

```
📄 main.ts → NestFactory.createApplicationContext(AppModule)   ❗ KHÔNG listen cổng nào
   │
   ▼
📄 app.module.ts:
     (1) ConfigModule.forRoot({isGlobal})   → đọc RABBITMQ_URL, SES_FROM_EMAIL, AWS_REGION
     (2) ConsumerModule → imports EmailModule
           📄 email/email.service.ts   → constructor đọc SES_FROM_EMAIL (rỗng = chế độ mock)
           📄 consumer/consumer.service.ts (provider)
   │
   ├─ 🌱 LIFECYCLE HOOK OnApplicationBootstrap:
   │     📄 consumer.service.ts → connect():
   │        🔌 amqp.connect(RABBITMQ_URL) ═══TCP═══► 🐰 rabbitmq
   │        ├─ assertExchange('orders','topic')            (khớp publisher order-service)
   │        ├─ assertExchange('orders.dlx','topic') + assertQueue('...dlq') + bind   (đường chết)
   │        ├─ assertQueue('notifications.order-created', { deadLetterExchange:'orders.dlx' })
   │        ├─ bindQueue(queue,'orders','order.created')   (đăng ký nghe event)
   │        └─ channel.consume(queue, handle)              ▶️ BẮT ĐẦU nghe
   │
   ├─ app.enableShutdownHooks()   → khi tắt: đóng channel + connection sạch
   └─ (không có app.listen)   ✅ worker READY — nằm chờ message, không nhận request từ ai
```

> Log nhận ra đã sẵn sàng: `[ConsumerService] Đang lắng nghe 'order.created' trên queue 'notifications.order-created'` rồi `[Bootstrap] notification-worker đã khởi động`.
> ❗ order-service **và** worker đều `assertExchange('orders','topic')` — ai boot trước cũng được, `assert` là idempotent (chưa có thì tạo, có rồi thì thôi). Nhờ vậy không cần ép thứ tự boot giữa 2 bên.

---

## 2. Bên trong api-gateway khởi động (process HTTP — giống monolith nhất)

Lệnh: dev `npm run start:dev` ; prod `node dist/main.js`. Bắt đầu từ `main.ts`.

```
📄 services/api-gateway/src/main.ts   ── ĐIỂM VÀO
   │  bootstrap()
   │
   ├─[a] NestFactory.create(AppModule)   ❗ create (có HTTP) — giống hệt monolith bạn quen
   │        │
   │        ▼
   │   📄 services/api-gateway/src/app.module.ts   ── khởi tạo module:
   │
   │     (1) ConfigModule.forRoot({isGlobal})   → đọc env (AUTH_GRPC_URL, JWT_SECRET...)
   │
   │     (2) 📄 auth-client/auth-client.module.ts   ── module "làm client của auth-service":
   │           ├─ ClientsModule.registerAsync([{ name: AUTH_CLIENT, GRPC, ... }])
   │           │     ├─ getProtoPath('auth.proto') ─► 📄 common/proto-path.util.ts
   │           │     └─ tạo provider ClientGrpc (AUTH_CLIENT) — ❗ CHƯA nối mạng (lazy)
   │           ├─ providers: 📄 auth-client.service.ts (AuthClientService)
   │           │             📄 jwt-auth.guard.ts     (JwtAuthGuard)
   │           └─ exports: [AuthClientService, JwtAuthGuard]  ← để module khác mượn guard
   │
   │     (2b) 📄 product-client/product-client.module.ts   ── (Day 3) "client của product-service":
   │           ├─ imports: [ AuthClientModule ]  ← MƯỢN JwtAuthGuard cho POST /products
   │           ├─ ClientsModule.registerAsync([{ name: PRODUCT_CLIENT, GRPC, url :50052 }])
   │           │     └─ getProtoPath('product.proto') → tạo ClientGrpc (PRODUCT_CLIENT), lazy
   │           ├─ providers: 📄 product-client.service.ts (ProductClientService)
   │           └─ controllers: 📄 product-client/product.controller.ts (ProductController)
   │
   │     (2c) 📄 order-client/order-client.module.ts   ── MỚI (Day 4) "client của order-service":
   │           ├─ imports: [ AuthClientModule ]  ← MƯỢN JwtAuthGuard (CẢ class /orders cần JWT)
   │           ├─ ClientsModule.registerAsync([{ name: ORDER_CLIENT, GRPC, url :50053 }])
   │           │     └─ getProtoPath('order.proto') → tạo ClientGrpc (ORDER_CLIENT), lazy
   │           ├─ providers: 📄 order-client.service.ts (OrderClientService)
   │           └─ controllers: 📄 order-client/order.controller.ts (OrderController)
   │
   │     (3) controllers của AppModule:
   │           📄 health/health.controller.ts (HealthController)
   │
   ├─[b] LIFECYCLE HOOK: onModuleInit()  (chạy cho MỌI provider có hook)
   │        📄 auth-client.service.ts → onModuleInit():
   │           this.authService = client.getService('AuthService')
   │           → tạo OBJECT PROXY (register/login/validateToken/refreshToken)
   │        📄 product-client.service.ts → onModuleInit():        ← (Day 3)
   │           this.productService = client.getService('ProductService')
   │           → tạo PROXY (create/findOne/findMany)
   │        📄 order-client.service.ts → onModuleInit():          ← MỚI (Day 4)
   │           this.orderService = client.getService('OrderService')
   │           → tạo PROXY (createOrder/findOne/findByUser)
   │        → cả 3 vẫn CHƯA gửi request nào; chỉ dựng sẵn "tay cầm" để gọi sau
   │
   ├─[c] app.useGlobalPipes(new ValidationPipe({...}))
   │        → cài "bộ lọc" validate cho MỌI request tương lai (dựa trên DTO)
   │           📄 auth-client/dto/auth.dto.ts sẽ được dùng khi có request, KHÔNG phải lúc này
   │
   └─[d] await app.listen(3000)   → 🚀 Express BIND cổng 3000, map & log các route:
            GET  /health
            POST /auth/register , POST /auth/login , POST /auth/refresh
            GET  /auth/me   (có JwtAuthGuard)
            GET  /products , GET /products/:id            ← (Day 3)
            POST /products  (có JwtAuthGuard)             ← (Day 3)
            POST /orders , GET /orders  (cả 2 có JwtAuthGuard)   ← MỚI (Day 4)
            (từ giờ gateway sẵn sàng nhận REST)
```

**File chỉ chạy KHI CÓ REQUEST, không phải lúc boot:**
- `dto/auth.dto.ts`, `product-client/dto/product.dto.ts`, `order-client/dto/order.dto.ts` — khi request tới, `ValidationPipe` mới dùng để kiểm body/query.
- `jwt-auth.guard.ts` — chỉ khi có request vào route được bảo vệ (`/auth/me`, `POST /products`, cả `/orders`).
- `common/rpc-to-http.ts` — chỉ khi service trả lỗi.
- Kết nối gRPC thật tới auth / product / order-service — chỉ xảy ra ở **request đầu tiên** tới mỗi service (lazy connect từ chỗ proxy). Lưu ý phân biệt: gRPC client của **gateway** nối lazy; còn kết nối **RabbitMQ** của order-service (publish) và notification-worker (consume) nối **ngay lúc boot** (Mục 1c/1d), không lazy.

---

## 3. So sánh 2 điểm vào — vì sao khác nhau

| | api-gateway `main.ts` | auth-service `main.ts` |
|---|---|---|
| Hàm bootstrap | `NestFactory.create()` | `NestFactory.createMicroservice()` |
| Mở cổng gì | HTTP (Express) `:3000` | gRPC `:50051` — KHÔNG có HTTP |
| Nhận gì | REST từ client bên ngoài | Chỉ nhận gRPC từ gateway (nội bộ) |
| Kết nối ra ngoài lúc boot | Không (gRPC client lazy) | CÓ: Postgres + Redis nối ngay khi module init |
| `app.listen(...)` | có tham số port | không tham số (URL lấy từ options gRPC) |

---

## 4. Toàn cảnh trình tự (timeline) khi `docker compose up`

```
t0  │ docker compose up -d
    │
t1  │ 🗄 postgres, 🔴 redis, 🐰 rabbitmq cùng start
    │   postgres: nếu volume mới → init-multiple-dbs.sh tạo auth_db/product_db/order_db
    │
t2  │ compose CHỜ healthcheck: postgres + redis + rabbitmq "healthy"
    │
t3  │ 🟦 auth-service + 🟪 product-service start (song song, chờ postgres healthy):
    │   auth-service:
    │     main.ts → createMicroservice → ConfigModule → TypeORM(auth_db)+migration(users)
    │       → JwtModule → RedisService connect Redis → AuthController(@GrpcMethod)
    │       → listen() bind :50051  ✅ auth-service READY
    │   product-service (Day 3):
    │     main.ts → createMicroservice → ConfigModule → TypeORM(product_db)+migration(products)
    │       → ProductController(@GrpcMethod)  (KHÔNG Jwt/Redis)
    │       → 🌱 SeedModule.OnApplicationBootstrap: seed 5 sản phẩm (idempotent)
    │       → listen() bind :50052  ✅ product-service READY
    │
t3' │ 🟧 order-service start (Day 4 — chờ postgres + rabbitmq healthy):
    │     main.ts → createMicroservice → ConfigModule → TypeORM(order_db)+migration(orders)
    │       → ProductClientModule (proxy gRPC :50052, lazy)
    │       → 🌱 MessagingModule.OnModuleInit: connect 🐰 rabbitmq + assertExchange('orders')
    │       → OrderController(@GrpcMethod) → listen() bind :50053  ✅ order-service READY
    │   🟨 notification-worker start (Day 4 — chờ rabbitmq healthy):
    │     main.ts → createApplicationContext (không cổng) → ConfigModule
    │       → 🌱 ConsumerService.OnApplicationBootstrap: connect 🐰 + assert exchange/queue/DLQ
    │         + consume('notifications.order-created')  ✅ worker READY (nằm nghe)
    │
t3''│ 🟩 api-gateway start (chờ auth + product "started"):
    │     main.ts → create → ConfigModule → Auth/Product/OrderClientModule (proxy, chưa nối)
    │       → onModuleInit dựng 3 proxy → ValidationPipe → listen(3000)  ✅ gateway READY
    │
t4  │ Tất cả READY. Client curl :3000/... → tới các flow ở day 2/3/4 mục 3.
    │ (gRPC gateway→service nối ở request ĐẦU TIÊN; RabbitMQ đã nối sẵn từ t3'.)
```

---

## 5. Cách tự quan sát trình tự này (thực hành)

```bash
# Xem log khởi động các service (thấy đúng thứ tự module init + dòng "successfully started")
docker compose logs auth-service
docker compose logs product-service      # Day 3 — tìm dòng seed 'thêm 5, bỏ qua 0'
docker compose logs order-service        # Day 4 — tìm "exchange 'orders' (topic) sẵn sàng"
docker compose logs notification-worker  # Day 4 — tìm "Đang lắng nghe 'order.created'..."
docker compose logs api-gateway

# Theo dõi trực tiếp lúc bật lại 1 service để thấy nó init từng bước:
docker compose restart auth-service && docker compose logs -f auth-service

# Chứng minh seed idempotent: restart product-service → in 'thêm 0, bỏ qua 5'
docker compose restart product-service && docker compose logs -f product-service

# Day 4: xem RabbitMQ topology sau khi worker boot
docker compose exec rabbitmq rabbitmqctl list_exchanges name type   # thấy 'orders', 'orders.dlx' (topic)
docker compose exec rabbitmq rabbitmqctl list_queues name messages consumers  # 'notifications.order-created' + '...dlq'
```
Trong log auth-service bạn sẽ thấy đúng thứ tự Nest in ra:
`TypeOrmModule dependencies initialized` → `JwtModule ...` → `TypeOrmCoreModule ...` →
`AppModule dependencies initialized` → `Nest microservice successfully started`.
Đó chính là các bước (1)→(6)→listen ở Mục 1.

> Mẹo gỡ lỗi thường gặp: nếu auth-service log `ECONNREFUSED ...:5432` hoặc `database "auth_db" does not exist` ngay lúc boot → nghĩa là bước TypeORM connect (Mục 1, khối (2)) thất bại. Nguyên nhân gần như luôn ở LỚP 1 (Postgres chưa healthy hoặc chưa có DB), không phải lỗi code auth-service.
