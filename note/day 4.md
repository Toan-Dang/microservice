# Day 4 — Order Service + Notification Worker (SYNC gRPC gặp ASYNC RabbitMQ)

> Đọc file này từ trên xuống. Giả định bạn đã đọc `note/day 3.md` (hiểu gRPC 2 process, TypeORM/migration, `CheckStock`, tái dùng `JwtAuthGuard` + `rpc-to-http.ts`).
> Day 3 dựng **product-service** và cố tình để lại `CheckStock` "chỉ gRPC, không REST" cho Day 4 dùng. Day 4 ghép mảnh cuối: **order-service** tạo đơn (gọi `CheckStock` **đồng bộ** để chốt hàng + giá) rồi **phát event** `order.created` **bất đồng bộ** qua RabbitMQ; **notification-worker** nghe event đó và gửi mail.
>
> **Khái niệm lớn nhất của Day 4:** phân biệt **SYNC** (gRPC — người gọi *chờ* kết quả, có kết quả mới đi tiếp) với **ASYNC** (RabbitMQ — người gửi *bắn rồi quên*, không chờ ai xử lý). Cả 2 xuất hiện trong **cùng một** request `POST /orders`.

---

## 1. Day 4 thêm gì so với Day 3

| | Day 3 | Day 4 |
|---|---|---|
| Service mới | product-service (gRPC :50052) | **order-service** (gRPC `:50053`) + **notification-worker** (KHÔNG cổng) |
| Database | `product_db` | **`order_db`** riêng (bảng `orders`); worker **không có DB** |
| Giao tiếp | Chỉ **sync** (gRPC) | **sync** (gRPC) **+ async** (RabbitMQ) trong cùng 1 flow |
| gRPC methods | Create/FindOne/FindMany/CheckStock | **CreateOrder / FindOne / FindByUser** |
| Gọi service khác | gateway → auth (validate) | order-service → product-service (**CheckStock**, sync) — service gọi service |
| Message broker | RabbitMQ chạy nhưng **chưa dùng** | RabbitMQ **dùng thật**: exchange `orders` (topic), key `order.created` |
| api-gateway REST | thêm `/products` | thêm **`/orders`** (POST tạo đơn, GET đơn của tôi) — **cả 2 cần JWT** |
| Xử lý lỗi nghiệp vụ | NOT_FOUND → 404 | thêm **FAILED_PRECONDITION (hết hàng) → 409** |
| Worker | Không | notification-worker: consumer + **DLQ + retry (≤3 lần)** + gửi mail (mock/SES) |

**Ý tưởng cốt lõi để khắc vào đầu:** một `POST /orders` sinh ra **2 kiểu lời gọi khác bản chất**:
- **SYNC** tới product-service: order-service **bắt buộc chờ** `CheckStock` trả lời — thiếu hàng thì **hủy luôn**, không tạo đơn. Đây là ràng buộc *phải đúng ngay bây giờ*.
- **ASYNC** tới notification-worker: sau khi lưu đơn, order-service **phát 1 event rồi trả kết quả ngay cho client**, KHÔNG chờ mail gửi xong. Gửi mail chậm/lỗi cũng **không** làm hỏng việc tạo đơn. Đây là việc *có thể làm sau, ai rảnh thì làm*.

---

## 2. Các file mới của Day 4 (và vai trò)

### order-service (service mới — cấu trúc y hệt product-service, thêm 2 nhóm: product-client + messaging)
```
services/order-service/
├── Dockerfile, package.json, tsconfig*, nest-cli.json,   # copy từ product-service;
│   eslint.config.mjs, .prettierrc                         # package.json thêm dep "amqplib"
└── src/
    ├── main.ts                        # bootstrap gRPC, package 'order', cổng 50053
    ├── app.module.ts                  # TypeORM(order_db) + ProductClientModule + MessagingModule
    ├── common/proto-path.util.ts      # copy y hệt (tìm file proto)
    ├── order/
    │   ├── order.controller.ts        # 3 @GrpcMethod: CreateOrder/FindOne/FindByUser
    │   ├── order.service.ts           # ⭐ logic: loop CheckStock → tính total → lưu → publish
    │   └── order.interface.ts         # type khớp proto/order.proto
    ├── entities/
    │   ├── order.entity.ts            # bảng "orders" (items lưu JSONB)
    │   └── index.ts                   # ENTITIES = [Order]
    ├── product-client/                # 📞 order-service làm CLIENT của product-service (gRPC)
    │   ├── product-client.constants.ts # chỉ khai đúng CheckStock (thứ nó cần)
    │   ├── product-client.module.ts    # ClientGrpc tới PRODUCT_GRPC_URL (:50052)
    │   └── product-client.service.ts   # checkStock(productId, qty) → Promise
    ├── messaging/                     # 📤 phát event qua RabbitMQ (amqplib trực tiếp)
    │   ├── messaging.constants.ts      # ORDER_EXCHANGE='orders', key='order.created', type OrderCreatedEvent
    │   ├── rabbitmq.publisher.ts        # ⭐ connect + assertExchange + publishOrderCreated()
    │   └── messaging.module.ts          # export RabbitmqPublisher
    ├── database/
    │   ├── data-source.ts             # cho TypeORM CLI
    │   └── migrations/<ts>-InitOrder.ts # SQL tạo bảng orders (+ index user_id)
    └── test/unit/order/order.service.spec.ts   # ⭐ test: tính total, publish, chặn hết hàng
```
> **KHÔNG có `seeds/`**: seed đơn hàng vô nghĩa (đơn phải sinh từ luồng thật, cần user + product thật). Đây là điểm khác product-service/auth-service.

### notification-worker (service mới — KHÔNG phải gRPC, KHÔNG phải HTTP)
```
services/notification-worker/
├── Dockerfile, package.json, ...      # package.json thêm "amqplib" + "@aws-sdk/client-ses"
└── src/
    ├── main.ts                        # ❗ NestFactory.createApplicationContext (KHÔNG listen cổng)
    ├── app.module.ts                  # ConfigModule + ConsumerModule
    ├── messaging.constants.ts         # ⭐ HỢP ĐỒNG event (phải khớp order-service): exchange/key/queue/DLQ/MAX_RETRIES
    ├── email/
    │   ├── email.service.ts           # ⭐ SES_FROM_EMAIL rỗng → mock (log); có → gửi AWS SES
    │   └── email.module.ts
    ├── consumer/
    │   ├── consumer.service.ts        # ⭐ connect RMQ, assert exchange/queue/DLQ, consume + retry
    │   └── retry.util.ts              # shouldRetry() / readRetryCount() — tách ra để unit test
    └── test/unit/{email,consumer}/    # test mock email + logic retry ≤3 lần
```

### api-gateway (thêm 1 nhóm "client của order-service")
```
services/api-gateway/src/
├── app.module.ts                      # (đổi) import thêm OrderClientModule
├── common/rpc-to-http.ts              # (đổi) thêm map 9 (FAILED_PRECONDITION) → 409
└── order-client/                      # MỚI — song song product-client/
    ├── order.controller.ts            # REST /orders — CẢ CLASS có @UseGuards(JwtAuthGuard)
    ├── order-client.service.ts        # proxy gRPC: createOrder / findByUser
    ├── order-client.module.ts         # ClientGrpc(:50053) + import AuthClientModule (mượn guard)
    ├── order-client.constants.ts      # tên package/service + interface gRPC
    └── dto/order.dto.ts               # CreateOrderDto (mảng items, ValidateNested)
```

---

## 3. FLOW CHART — mỗi request đi qua những file nào

> Quy ước như Day 2/3: `│`/`▼` đi sâu vào; `▲` trả ngược lên; `═══` = ranh giới NETWORK (2 process khác nhau).
> Day 4 thêm ký hiệu **`⇢⇢⇢`** = ranh giới **ASYNC** (bắn event rồi đi tiếp, KHÔNG chờ đầu kia).

### 3.1. `POST /orders` — flow lớn nhất từ trước tới giờ (chạm 4 process)

```
   curl POST localhost:3000/orders -H "Authorization: Bearer <token>"
        -d '{"items":[{"productId":"<kbd>","quantity":2},{"productId":"<mouse>","quantity":1}]}'
        │
        ▼
╔══════════════════════════ PROCESS 1: api-gateway (:3000) ═════════════════════════════════╗
║  [1] @UseGuards(JwtAuthGuard) (cả class OrderController) → CHẠY GUARD TRƯỚC                 ║
║       📄 auth-client/jwt-auth.guard.ts → validateToken(token) ═══gRPC═══► PROCESS 4: auth   ║
║        └─ valid=true → gắn req.user = { userId, email }  ← email lấy TỪ TOKEN, không từ body ║
║  [2] main.ts ValidationPipe so body với 📄 order-client/dto/order.dto.ts                    ║
║        (items ≥ 1 phần tử; mỗi item productId không rỗng, quantity ≥ 1) → sai → 400         ║
║  [3] 📄 order-client/order.controller.ts → create(req, dto)                                 ║
║        → orderClientService.createOrder(req.user.userId, req.user.email, dto.items)         ║
║        ❗ userId & email lấy từ req.user (JWT) — client KHÔNG tự khai được (chống giả mạo)   ║
║  [4] 📄 order-client.service.ts → PROXY gRPC createOrder(...)                                ║
╚═══════════════════════════════════════│═══════════════════════════════════════════════════╝
              ═══════════════ gRPC ═══════════════ (sang PROCESS 2)
                                         │
╔═══════════════════════════════════════▼═══ PROCESS 2: order-service (:50053) ═════════════╗
║  [5] 📄 order/order.controller.ts → @GrpcMethod('OrderService','CreateOrder')              ║
║  [6] 📄 order/order.service.ts → create(data):                                             ║
║        ├─ items rỗng / thiếu userId / quantity≤0 → RpcException INVALID_ARGUMENT (3)        ║
║        │                                                                                     ║
║        ├─ 🔁 VỚI MỖI item:  (đây là phần SYNC — chờ từng cái một)                           ║
║        │     📄 product-client.service.ts → checkStock(productId, qty)                      ║
║        │        └─► ═══gRPC═══► PROCESS 3: product-service.CheckStock                       ║
║        │              ◄─ { available, price, remaining }                                    ║
║        │     ├─ available=false → RpcException FAILED_PRECONDITION (9)  ❌ DỪNG, KHÔNG lưu   ║
║        │     └─ available=true  → chốt price từ CheckStock, cộng vào total                  ║
║        │                                                                                     ║
║        ├─ 🔁 VỚI MỖI item (lượt 2, tuần tự): decrementStock(productId, qty)                 ║
║        │     └─► ═══gRPC═══► PROCESS 3: product-service.DecrementStock                      ║
║        │           UPDATE product SET stock=stock-qty WHERE id=? AND stock>=qty  (ATOMIC)   ║
║        │        ├─ affected=0 (hết hàng do RACE với đơn khác) → rollbackDecrements():        ║
║        │        │     releaseStock() hoàn kho các item đã trừ → RpcException FAILED_PRECOND ❌║
║        │        └─ affected=1 → tiếp item sau                                                ║
║        │   ⚠️ CheckStock ở lượt 1 chỉ là SNAPSHOT; DecrementStock atomic mới CHẶN RACE thật ║
║        │                                                                                     ║
║        ├─ this.orders.save({ userId, email, items(JSONB), total, status:'PENDING' })        ║
║        │        └─► INSERT ─► 🗄 order_db                                                    ║
║        │                                                                                     ║
║        └─ 📤 publisher.publishOrderCreated({orderId,userId,items,total,email})              ║
║              📄 messaging/rabbitmq.publisher.ts                                             ║
║              channel.publish('orders','order.created', JSON, {persistent})                  ║
║              ⇢⇢⇢ bắn vào RabbitMQ rồi TRẢ VỀ NGAY (không chờ worker)                        ║
║              (publish lỗi → chỉ log, KHÔNG rollback đơn — đơn đã PENDING trong DB)          ║
║        ▲ trả Order { id, ..., status:'PENDING' }                                            ║
╚═══════════════════════════════════════│═══════════════════════════════════════════════════╝
              ═══════════════ gRPC trả về ═══════════════           ⇢⇢⇢ (nhánh async, xem 3.3)
                                         │                              │
╔═══════════════════════════════════════▼═══ PROCESS 1 ═════════════╗  │  🐰 RabbitMQ giữ message
║  [7] order.controller.ts → JSON 201 { id, total, status:PENDING }  ║  │  trong queue tới khi worker
╚═══════════════════════════════════════════════════════════════════╝  ▼  lấy (xem 3.3)
   Client nhận đơn NGAY, dù mail chưa gửi.
```

> **Đây là bức tranh microservice đầy đủ nhất:** 1 request chạm **4 process** — gateway → auth (xác thực) → order (điều phối) → product (kiểm **và trừ kho atomic**) — cộng thêm **1 nhánh async** rẽ sang RabbitMQ → worker. So với Day 3 (`POST /products` chạm 3 process **toàn sync**), Day 4 là lần đầu có nhánh *không đồng bộ* tách khỏi đường trả về.

### 3.2. `GET /orders` — đơn của user hiện tại (cần JWT, thuần sync)

```
[1] JwtAuthGuard → req.user.userId
[3] order.controller.ts → listMine(req) → orderClientService.findByUser(req.user.userId)
     ═══gRPC═══► order-service.FindByUser(userId)
        📄 order.service.ts → this.orders.find({ where:{userId}, order:{createdAt:'ASC', id:'ASC'} })
        (❗ vẫn giữ tie-breaker `id` như Day 3 — tránh trùng/sót khi sau này phân trang)
     ◄─ { orders:[...] } → controller bọc { data:[...] } → JSON 200
```
> Chú ý bảo mật: gateway **luôn** truyền `req.user.userId` (từ token), không nhận `userId` từ query — user chỉ xem được đơn **của chính mình**.

### 3.3. Nhánh ASYNC — event `order.created` được worker xử lý thế nào

Đây là phần chạy **độc lập** với request `POST /orders` ở trên (client đã nhận 201 từ lâu).

```
🐰 RabbitMQ:  exchange 'orders' (topic) ──[routing key = 'order.created']──► queue 'notifications.order-created'
                                                                                    │  (worker đã bind + consume từ lúc boot)
                                                                                    ▼
╔═══════════════════════ PROCESS 5: notification-worker (không cổng) ═══════════════════════╗
║  📄 consumer/consumer.service.ts → handle(msg):                                            ║
║    ├─ đọc header 'x-retry-count' (mặc định 0)   ← 📄 retry.util.ts readRetryCount()        ║
║    ├─ JSON.parse(msg.content) → OrderCreatedEvent { orderId, email, total, items }          ║
║    ├─ 📄 email/email.service.ts → sendOrderConfirmation(event):                            ║
║    │     ├─ SES_FROM_EMAIL rỗng → log 'Email sent to <email> (MOCK) ...'   (demo local)     ║
║    │     └─ SES_FROM_EMAIL có   → SESClient.send(SendEmailCommand)  (gửi thật)             ║
║    ├─ THÀNH CÔNG → channel.ack(msg)   ✅ message rời queue                                  ║
║    └─ LỖI:                                                                                  ║
║        📄 retry.util.ts shouldRetry(retries):                                              ║
║          ├─ retries < 3 → publish lại vào 'orders' với header x-retry-count+1, rồi ack gốc  ║
║          │                 (⟳ requeue — thử lại tối đa 3 lần)                               ║
║          └─ retries ≥ 3 → channel.nack(msg, requeue=false)                                  ║
║                            └─► 🐰 DLX 'orders.dlx' ─► queue 'notifications.order-created.dlq' ║
║                               (message "chết" nằm ở DLQ để soi sau, KHÔNG mất, KHÔNG lặp vô hạn) ║
╚═══════════════════════════════════════════════════════════════════════════════════════════╝
```

---

## 4. Thứ tự đọc file để hiểu Day 4 (đề xuất)

1. `proto/order.proto` — hợp đồng gRPC. Chú ý message mới `email` trong `CreateOrderRequest` (xem Mục 6.5).
2. `order-service/src/entities/order.entity.ts` — bảng `orders`, `items` kiểu JSONB.
3. `order-service/src/product-client/product-client.service.ts` — order gọi product (client gRPC "rút gọn", chỉ CheckStock).
4. `order-service/src/messaging/rabbitmq.publisher.ts` — **cách publish** vào topic exchange bằng amqplib.
5. `order-service/src/order/order.service.ts` — **đọc kỹ nhất**: loop CheckStock → total → save → publish.
6. `notification-worker/src/messaging.constants.ts` — **hợp đồng event** (exchange/key/queue/DLQ/MAX_RETRIES).
7. `notification-worker/src/consumer/consumer.service.ts` — assert topology + consume + retry/DLQ.
8. `notification-worker/src/email/email.service.ts` — nhánh mock vs SES.
9. `api-gateway/src/order-client/order.controller.ts` — REST `/orders`, chỗ lấy `req.user` thay vì body.

---

## 5. Giải thích `app.module.ts` của order-service (so với product-service Day 3)

```ts
imports: [
  ConfigModule.forRoot({ isGlobal: true }),      // đọc DATABASE_URL, GRPC_URL, PRODUCT_GRPC_URL, RABBITMQ_URL
  TypeOrmModule.forRootAsync({ ...order_db }),    // giống Day 3: migrationsRun:true, synchronize:false
  TypeOrmModule.forFeature([Order]),              // inject Repository<Order>
  ProductClientModule,                            // MỚI: gRPC client tới product-service (sync)
  MessagingModule,                                // MỚI: RabbitmqPublisher (async)
],
controllers: [OrderController],
providers: [OrderService],
```
So với product-service: **thêm 2 module** — `ProductClientModule` (đi gọi service khác) và `MessagingModule` (phát event). Đây là lần đầu một **service** (không phải gateway) vừa **làm client gRPC** của service khác, vừa **nói chuyện với message broker**. Không có `SeedModule`.

---

## 6. Những cái MỚI về mặt kỹ thuật ở Day 4

### 6.1. SYNC (gRPC) vs ASYNC (RabbitMQ) — vì sao chọn cái nào

| | gRPC (sync) — `CheckStock` | RabbitMQ (async) — `order.created` |
|---|---|---|
| Người gọi | **chờ** kết quả rồi mới đi tiếp | **bắn rồi quên**, đi tiếp ngay |
| Nếu đầu kia lỗi/chậm | request hỏng luôn (đúng ý: thiếu hàng thì đừng tạo đơn) | không ảnh hưởng tạo đơn; xử lý lại sau |
| Kết nối | điểm-tới-điểm (biết địa chỉ product-service) | qua broker (order **không biết** ai nghe) |
| Dùng khi | cần câu trả lời *ngay* để quyết định | việc phụ, làm sau cũng được (gửi mail) |

**Luật chọn:** cái gì **quyết định request đúng/sai** → sync. Cái gì là **hệ quả phụ, chịu được trễ** → async. Tạo đơn mà chờ gửi mail xong mới trả 201 là thiết kế tồi: mail chậm 3 giây thì client chờ 3 giây, SES sập thì không đặt được hàng.

### 6.2. RabbitMQ topic exchange — 3 khái niệm phải nắm

```
   order-service ──publish──►  [exchange 'orders' type=topic]
                                      │  so 'order.created' (routing key) với các binding
                                      ▼
                               [queue 'notifications.order-created']  bound key='order.created'
                                      │
                               notification-worker consume
```
- **Exchange** = "bưu cục". Publisher **không** gửi thẳng vào queue, mà gửi vào exchange kèm 1 **routing key**.
- **Topic exchange** = định tuyến theo *mẫu* routing key (vd `order.*`, `order.#`). Chọn topic để sau này thêm `order.cancelled`, `order.paid`... các worker khác bind mẫu khác nhau mà **không sửa order-service**.
- **Queue + binding** = "hộp thư". Worker tạo queue của mình rồi **bind** vào exchange với key quan tâm. Exchange chép message vào mọi queue có binding khớp.
> Lợi ích so với gRPC: order-service **không biết** có bao nhiêu worker đang nghe, cũng không cần địa chỉ của chúng. Thêm 1 worker mới (vd cập nhật kho, ghi analytics) = tạo thêm queue bind vào `orders`, order-service **không đổi 1 dòng**. Đây là **loose coupling**.

### 6.3. Vì sao dùng `amqplib` trực tiếp, không dùng Nest RMQ transport

Nest có `Transport.RMQ` sẵn, nhưng nó mô hình hóa theo kiểu **1 queue cố định + request/response**, khó khai báo **topic exchange + routing key tùy ý + DLQ**. Ở đây ta cần chủ động `assertExchange('orders','topic')`, `assertQueue(..., { deadLetterExchange })`, `bindQueue(...)` — nên dùng thẳng `amqplib` cho rõ ràng và đúng hợp đồng đề bài (`exchange 'orders' topic, key 'order.created'`).

Kiểu kết nối được viết version-agnostic để khỏi phụ thuộc tên type đổi giữa các bản amqplib:
```ts
type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;
type AmqpChannel = Awaited<ReturnType<AmqpConnection['createChannel']>>;
```
Publisher connect ở `OnModuleInit` (lỗi lúc boot chỉ log, publish sau sẽ tự reconnect); consumer connect ở `OnApplicationBootstrap`. Cả 2 đóng kết nối sạch ở `OnModuleDestroy` (nhờ `app.enableShutdownHooks()`).

### 6.4. Dead-letter queue + retry đếm bằng header (điểm học chính của worker)

`amqplib` **không tự đếm** số lần requeue. Nếu chỉ `nack(requeue=true)` khi lỗi → message quay lại queue **ngay lập tức** và lặp **vô hạn** (busy-loop). Cách làm đúng ở đây:
```
lỗi xử lý message:
  retries = header['x-retry-count'] || 0
  nếu retries < 3:  publish lại vào exchange với header x-retry-count = retries+1  →  ack bản gốc
  nếu retries ≥ 3:  nack(requeue=false)  →  message rơi qua DLX 'orders.dlx' → queue '...dlq'
```
- **Đếm số lần** nằm ở header nên "requeue tối đa 3 lần" thành hiện thực (0→1→2→3 rồi dừng).
- Queue chính khai `{ deadLetterExchange: 'orders.dlx' }`: khi `nack(requeue=false)`, RabbitMQ tự đẩy message sang DLX → DLQ, thay vì vứt đi. DLQ là "nơi khám nghiệm" các message chết — không mất dữ liệu, không kẹt queue chính.
- `shouldRetry()` / `readRetryCount()` tách ra `retry.util.ts` để **unit test được** mà không cần RabbitMQ thật (xem `test/unit/consumer/retry.util.spec.ts`).

### 6.5. Vì sao phải thêm `email` vào `proto/order.proto`

Payload event yêu cầu có `email` để worker biết gửi cho ai. Nhưng **database-per-service**: order-service **không được** truy vấn `auth_db` để tra email theo `userId`. Ai biết email? → **api-gateway**, vì `JwtAuthGuard` đã giải mã token ra `req.user.email`. Nên đường đi của email là: token → gateway (`req.user.email`) → `CreateOrderRequest.email` (gRPC) → order-service → event. Vì thế thêm 1 field vào proto:
```proto
message CreateOrderRequest {
  string user_id = 1;
  repeated OrderItemInput items = 2;
  string email = 3;   // ⭐ thêm ở Day 4 — lấy từ JWT, không phải client tự khai
}
```
> Nguyên tắc CLAUDE.md: "cần đổi proto thì sửa proto rồi cập nhật CẢ 2 phía". Ở đây cả gateway (điền email) và order-service (đọc email) đều được cập nhật.

### 6.6. `items` lưu JSONB + chốt giá tại thời điểm đặt
Bảng `orders` lưu `items` kiểu **JSONB** (`[{productId, quantity, price}]`) thay vì tách bảng `order_items` — đủ gọn cho phạm vi học, đọc/ghi 1 phát. Quan trọng: **`price` chốt từ `CheckStock`** lúc đặt, không tin giá client gửi và không phụ thuộc giá product-service đổi sau này (đơn cũ giữ nguyên giá đã mua). `total = Σ price×quantity` cũng tính ở order-service.

### 6.7. Worker là `ApplicationContext`, không mở cổng
`notification-worker/src/main.ts` dùng `NestFactory.createApplicationContext(AppModule)` — **không** `create` (HTTP) cũng **không** `createMicroservice` (gRPC). Nó không nhận request từ ai; chỉ là 1 process có DI + Config + Logger, và `ConsumerService` tự mở kết nối RabbitMQ trong `OnApplicationBootstrap` để **chủ động kéo** message về. Đây là dạng "background worker" thuần.

### 6.8. `FAILED_PRECONDITION` → HTTP 409
Hết hàng là **lỗi nghiệp vụ có thể lường trước**, không phải server sập. order-service ném `RpcException(FAILED_PRECONDITION=9)`; `rpc-to-http.ts` (Day 2) chưa map code 9 nên mặc định ra **500** (sai — trông như bug server). Day 4 thêm `9 → 409 CONFLICT` để client nhận đúng "xung đột trạng thái (hết hàng)".

---

## 7. Sự cố hạ tầng gặp khi chạy Day 4 (và cách đã sửa)

Ba lỗi môi trường/compose lộ ra khi lần đầu `docker compose up` với 2 service mới — không phải lỗi logic Day 4, nhưng ghi lại để không mất thời gian lần sau:

1. **`postgres` exited (126): `/bin/bash: bad interpreter`.** `infra/init-multiple-dbs.sh` để shebang `#!/bin/bash`, mà image `postgres:16-alpine` **không có bash** → script tạo nhiều DB chết → `order_db` (và cả `auth_db/product_db` trên volume mới) không được tạo. **Sửa:** đổi sang `#!/bin/sh` + cú pháp POSIX (bỏ từ khóa `function`).
2. **order-service / notification-worker exit (127): `sh: nest: not found`.** 2 service mới trong `docker-compose.yml` **thiếu** anonymous volume `- /app/services/<name>/node_modules`. Bind mount source từ host đè lên → che mất `node_modules` mà image đã cài (repo dùng npm workspaces, deps hoist lên root nên thư mục service trên host **không có** node_modules). **Sửa:** thêm dòng volume đó cho cả 2 (giống các service Day 1–3 đã có).
3. **Hết hàng trả 500 thay vì 409** — xem Mục 6.8.

> Bài học chung: khi thêm service vào compose, **copy đủ khối `volumes`** (gồm anonymous `node_modules`) từ service cũ, và nhớ image alpine chỉ có `sh`.

---

## 8. Tóm tắt: cái gì LẶP LẠI, cái gì MỚI (so với Day 3)

**Lặp lại y hệt (đã biết → làm nhanh):**
- Cấu trúc service gRPC: `main.ts`(createMicroservice) → `app.module.ts` → controller(`@GrpcMethod`) → service → entity; TypeORM + migration + `migrationsRun` + `synchronize:false`.
- Cấu trúc "client" ở gateway (module `registerAsync` ClientGrpc → service proxy `firstValueFrom` → controller REST → DTO), tái dùng `JwtAuthGuard` + `rpc-to-http.ts`.
- Sort phân trang có tie-breaker `id` (`FindByUser`).

**Mới ở Day 4:**
- **Service gọi service** qua gRPC (order → product `CheckStock`) — không chỉ gateway đi gọi nữa.
- **Async messaging**: RabbitMQ topic exchange + routing key + queue binding; publish bằng `amqplib`.
- **Worker** dạng `ApplicationContext` (không cổng) + **DLQ + retry đếm bằng header (≤3 lần)**.
- **Gửi mail** mock/SES tùy `SES_FROM_EMAIL`.
- Thêm field vào **proto** và cập nhật cả 2 phía; map lỗi nghiệp vụ **409**.
- Lưu snapshot `items` JSONB + **chốt giá** lúc đặt.

---

## 9. Gợi ý thực hành để hiểu sâu (tự làm)

1. Mở 2 cửa sổ log: `docker compose logs -f order-service` và `docker compose logs -f notification-worker`. Rồi login + `POST /orders`. Thấy order log `Published 'order.created' ...` **trước**, worker log `Nhận order.created ...` → `Email sent to ... (MOCK)` **ngay sau** — hai process rời nhau qua broker.
2. Đặt sản phẩm **hết hàng** (SSD seed `stock=0`): `POST /orders` với productId đó → **409** `không đủ hàng`, và `SELECT * FROM orders` trong `order_db` **không** có đơn mới, worker **không** nhận event gì. Chứng minh nhánh sync chặn từ sớm.
3. Mở RabbitMQ UI `http://localhost:15672` (guest/guest) → tab **Exchanges** thấy `orders` (topic) + `orders.dlx`; tab **Queues** thấy `notifications.order-created` (1 consumer) + `...dlq`. Xem `messages` về 0 sau khi worker xử lý.
4. **Thử retry/DLQ:** tạm sửa `email.service.ts` cho `throw new Error('test')` ở nhánh mock, rebuild worker, `POST /orders` → xem log requeue lần 1→2→3 rồi `đẩy sang DLQ`; vào UI thấy 1 message nằm trong `notifications.order-created.dlq`. Nhớ hoàn tác.
5. Chạy `npm test` trong `services/order-service` — đọc `order.service.spec.ts`: repo + product-client + publisher đều **giả lập**, kiểm `total`, kiểm có `publishOrderCreated`, kiểm hết hàng thì **không** save/không publish.
6. `docker compose exec postgres psql -U app -d order_db -c 'SELECT id,total,status,items FROM orders;'` — nhìn cột `items` JSONB và `price` đã chốt trong đó.
7. (Suy ngẫm thiết kế) Nếu publish RabbitMQ **thành công** nhưng ngay sau đó order-service crash trước khi trả 201 cho client thì sao? → client tưởng thất bại nhưng đơn đã tạo + mail đã gửi. Đây là bài toán *at-least-once* / *idempotency* — gợi mở cho các ngày sau (ghi outbox, khử trùng theo orderId).
