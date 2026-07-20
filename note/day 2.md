# Day 2 — Auth Service hoàn chỉnh (DB + bcrypt + JWT + Redis + Migration)

> Đọc file này từ trên xuống. Giả định bạn đã đọc `note/day 1.md` (hiểu gRPC, proto, client proxy).
> Day 1 chứng minh 2 process nói chuyện được qua gRPC bằng **data giả**. Day 2 thay data giả bằng **logic thật**: lưu user vào Postgres, băm mật khẩu, phát JWT, lưu refresh token trong Redis, và bảo vệ route bằng guard.

---

## 1. Day 2 thêm gì so với Day 1

| | Day 1 | Day 2 |
|---|---|---|
| `auth.service.ts` | Trả `stub-access-token` cố định | Logic thật: bcrypt, JWT, query DB, Redis |
| Database | Chưa có | Postgres `auth_db` qua TypeORM (entity `User`) |
| Mật khẩu | Không xử lý | Băm bằng **bcrypt** trước khi lưu (không bao giờ lưu plaintext) |
| Token | Chuỗi giả | **JWT** thật ký bằng `JWT_SECRET`, access 15m / refresh 7d |
| Refresh token | Không có | Lưu trong **Redis** (`refresh:<userId>`), có xoay vòng (rotation) |
| api-gateway | Chỉ có `/auth/ping` | REST thật: `POST /auth/register`, `/login`, `/refresh` |
| Bảo vệ route | Chưa có | **`JwtAuthGuard`** gọi `ValidateToken` qua gRPC (route mẫu `GET /auth/me`) |
| Schema DB | — | Quản lý bằng **TypeORM migration** (không dùng `synchronize`) |
| Validate input | Không | `class-validator` + `ValidationPipe` ở gateway (DTO) |

**Ý tưởng cốt lõi để khắc vào đầu:** api-gateway vẫn là nơi **duy nhất** nói HTTP với client. Mọi thứ "thật" (DB, hash, token) nằm ở **auth-service** — gateway chỉ là cửa ngõ, nhận REST rồi chuyển tiếp qua gRPC. Client **không bao giờ** gọi thẳng auth-service.

---

## 2. Các file mới của Day 2 (và vai trò)

### auth-service (nơi chứa logic thật)
```
services/auth-service/src/
├── main.ts                         # (đổi nhẹ) thêm enableShutdownHooks để đóng Redis sạch
├── app.module.ts                   # (đổi nhiều) wire TypeORM + JwtModule + RedisService
├── data-source.ts                  # MỚI — cấu hình cho TypeORM CLI (chỉ chạy khi gõ lệnh migration, KHÔNG chạy lúc server bật)
├── auth/
│   ├── auth.controller.ts          # (đổi) handler gRPC giờ async, truyền cả password
│   ├── auth.service.ts             # (viết lại) TOÀN BỘ logic thật ở đây
│   ├── user.entity.ts              # MỚI — entity TypeORM = bảng "users"
│   ├── auth.interface.ts           # type khớp proto (giữ nguyên từ Day 1)
│   └── auth.service.spec.ts        # MỚI — unit test hash + token
├── redis/
│   └── redis.service.ts            # MỚI — bọc ioredis, lưu/đọc refresh token
└── migrations/
    └── <timestamp>-InitAuth.ts     # MỚI — lệnh SQL tạo bảng users (đọc kỹ ở mục 6)
```

### api-gateway (cửa ngõ REST)
```
services/api-gateway/src/
├── main.ts                         # (đổi) thêm ValidationPipe global để validate DTO
├── auth-client/
│   ├── auth.controller.ts          # (viết lại) REST /auth/register, /login, /refresh, /me
│   ├── auth-client.service.ts      # (đổi) thêm hàm register/login/refresh/validateToken gọi proxy gRPC
│   ├── auth-client.module.ts       # (đổi) provide + export JwtAuthGuard
│   ├── jwt-auth.guard.ts           # MỚI — guard bảo vệ route, gọi ValidateToken qua gRPC
│   └── dto/auth.dto.ts             # MỚI — RegisterDto/LoginDto/RefreshDto (class-validator)
└── common/
    └── rpc-to-http.ts              # MỚI — đổi lỗi gRPC (status code) sang lỗi HTTP (400/401/409...)
```

---

## 3. FLOW CHART — 1 request đi qua những file nào

> Đây là phần bạn yêu cầu: đi vào file nào trước, rồi file nào, khi nào "return" quay ngược lại.
> Quy ước: `│` đi xuống = đi sâu vào; `▲` = giá trị trả ngược lên; `═══` = ranh giới NETWORK (2 process khác nhau!).

### 3.1. `POST /auth/register` (đăng ký — flow đầy đủ nhất)

```
   curl POST localhost:3000/auth/register  { "email": "...", "password": "..." }
        │  (HTTP)
        ▼
╔══════════════════════════ PROCESS 1: api-gateway (port 3000) ══════════════════════════╗
║                                                                                          ║
║  [1] main.ts (đang chạy sẵn)                                                             ║
║       → ValidationPipe global chặn request, so body với RegisterDto                      ║
║         📄 auth-client/dto/auth.dto.ts   ── nếu email sai / pass < 8 ký tự → trả 400 luôn║
║         (KHÔNG đi tiếp xuống controller)                                                 ║
║       │  body hợp lệ                                                                      ║
║       ▼                                                                                   ║
║  [2] 📄 auth-client/auth.controller.ts  →  register(dto)                                 ║
║       │  gọi                                                                              ║
║       ▼                                                                                   ║
║  [3] 📄 auth-client/auth-client.service.ts  →  register(email, password)                 ║
║       → this.authService.register({email,password})  ← "authService" là PROXY (Day 1)    ║
║       → firstValueFrom(...) đổi Observable → Promise                                      ║
║       │                                                                                   ║
║       ▼  ❗ gọi lên proxy = BẮN 1 REQUEST gRPC QUA MẠNG (không phải gọi hàm JS)           ║
╚═══════════════════════════════════════│══════════════════════════════════════════════════╝
                                         │
              ═══════════════ gRPC (network, protobuf nhị phân) ═══════════════
                                         │
╔═══════════════════════════════════════▼═══ PROCESS 2: auth-service (port 50051) ═════════╗
║                                                                                           ║
║  [4] gRPC server (bật sẵn từ main.ts) route request tới đúng @GrpcMethod                  ║
║       📄 auth/auth.controller.ts  →  @GrpcMethod('AuthService','Register') register(data) ║
║       │  gọi                                                                              ║
║       ▼                                                                                   ║
║  [5] 📄 auth/auth.service.ts  →  register(email, password)   ⭐ TRÁI TIM LOGIC            ║
║       ├─ validateCredentials()        (regex email + độ dài mật khẩu)                     ║
║       ├─ this.users.findOne()   ─────► 📄 auth/user.entity.ts (định nghĩa bảng)          ║
║       │        │                                                                          ║
║       │        └──► TypeORM sinh SQL ──► ═══ TCP ═══► 🗄  Postgres (auth_db)              ║
║       │             (nếu email đã tồn tại → ném RpcException ALREADY_EXISTS)              ║
║       ├─ bcrypt.hash(password)        (băm, ~10 vòng salt)                                ║
║       ├─ this.users.save()      ─────► INSERT ──► ═══► 🗄 Postgres                        ║
║       └─ issueTokens(userId, email):                                                      ║
║            ├─ this.jwt.signAsync(access, 15m) ─► dùng JwtModule (secret = JWT_SECRET)     ║
║            ├─ this.jwt.signAsync(refresh, 7d)                                             ║
║            └─ this.redis.setWithTtl('refresh:<id>', token) ─► 📄 redis/redis.service.ts   ║
║                     │                                                                     ║
║                     └──► ═══ TCP ═══► 🔴 Redis  (lưu refresh token, TTL 7 ngày)          ║
║       │                                                                                   ║
║       ▲  return { userId, email, accessToken, refreshToken }                              ║
║  [6] 📄 auth.controller.ts trả Promise → gRPC đóng gói kết quả gửi ngược                  ║
╚═══════════════════════════════════════│═══════════════════════════════════════════════════╝
                                         │
              ═══════════════ gRPC trả response về ═══════════════
                                         │
╔═══════════════════════════════════════▼═══ PROCESS 1: api-gateway ═══════════════════════╗
║  [7] 📄 auth-client.service.ts: firstValueFrom resolve → trả object về controller         ║
║       ▲                                                                                    ║
║  [8] 📄 auth.controller.ts: return object                                                  ║
║       → NestJS serialize thành JSON, status 201                                            ║
╚═══════════════════════════════════════│═══════════════════════════════════════════════════╝
        │
        ▼
   Client nhận { userId, email, accessToken, refreshToken }
```

> **Nếu có lỗi ở bước [5]** (ví dụ email trùng): `auth.service.ts` ném `RpcException({code, message})`. Lỗi này chui ngược qua gRPC về gateway, rơi vào `try/catch` trong `auth.controller.ts`, được `📄 common/rpc-to-http.ts` đổi từ mã gRPC (6 = ALREADY_EXISTS) sang HTTP `409 Conflict`. Đó là lý do client thấy đúng status code REST.

### 3.2. `POST /auth/login` — giống hệt register nhưng logic bước [5] khác

Chỉ khác nội dung file `auth.service.ts → login()`:
```
[5] login(email, password):
     ├─ this.users.findOne({email})           ──► Postgres SELECT
     ├─ bcrypt.compare(password, user.hash)    (so mật khẩu; luôn compare kể cả khi
     │                                          không có user → tránh lộ timing)
     │      └─ sai email HOẶC sai pass → RpcException UNAUTHENTICATED → gateway đổi thành 401
     └─ issueTokens(...)                        (y hệt register: JWT + lưu Redis)
```
Đường đi qua các file `[1]→[2]→[3]→gRPC→[4]→[5]→...→[8]` **không đổi**, chỉ thân hàm ở service khác.

### 3.3. `GET /auth/me` — route ĐƯỢC BẢO VỆ (guard chạy TRƯỚC controller)

Đây là điểm mới quan trọng: có 1 file `jwt-auth.guard.ts` xen vào **trước khi** handler chạy.

```
   curl GET localhost:3000/auth/me   -H "Authorization: Bearer <access_token>"
        │
        ▼
╔══════════════════════════ PROCESS 1: api-gateway ════════════════════════════════════════╗
║  [1] NestJS thấy route /auth/me có @UseGuards(JwtAuthGuard)                                 ║
║       → chạy GUARD TRƯỚC, controller CHƯA chạy                                              ║
║       ▼                                                                                      ║
║  [2] 📄 auth-client/jwt-auth.guard.ts  →  canActivate()                                     ║
║       ├─ tách "Bearer <token>" từ header (không có → 401 ngay, không gọi gRPC)             ║
║       └─ this.authClientService.validateToken(token)                                        ║
║              │                                                                               ║
║              ▼ (gọi qua service → proxy)                                                     ║
║  [3] 📄 auth-client.service.ts → validateToken() → proxy gRPC                               ║
╚══════════════════════════════════════│═══════════════════════════════════════════════════════╝
              ═══════════════ gRPC ═══════════════
                                        │
╔═══════════════════════════════════════▼═══ PROCESS 2: auth-service ══════════════════════════╗
║  [4] 📄 auth/auth.controller.ts → @GrpcMethod ValidateToken                                   ║
║  [5] 📄 auth/auth.service.ts → validateToken(accessToken):                                    ║
║        ├─ this.jwt.verifyAsync(token)   (kiểm chữ ký + hạn bằng JWT_SECRET)                   ║
║        ├─ kiểm payload.type === 'access'                                                      ║
║        └─ trả { valid: true, userId, email }  (token hỏng → { valid:false } — KHÔNG ném lỗi) ║
║        ▲                                                                                       ║
╚═══════════════════════════════════════│═══════════════════════════════════════════════════════╝
              ═══════════════ gRPC trả về ═══════════════
                                        │
╔═══════════════════════════════════════▼═══ PROCESS 1: api-gateway ═══════════════════════════╗
║  [6] 📄 jwt-auth.guard.ts nhận { valid, userId, email }:                                      ║
║        ├─ valid = false  → ném UnauthorizedException → 401 (controller KHÔNG chạy)           ║
║        └─ valid = true   → gắn req.user = { userId, email }, return true                     ║
║        │                                                                                       ║
║        ▼  guard cho qua                                                                         ║
║  [7] 📄 auth-client/auth.controller.ts → me(req)  →  return { user: req.user }               ║
║        → JSON 200                                                                              ║
╚═══════════════════════════════════════════════════════════════════════════════════════════════╝
```

> Điểm hay: auth-service **không biết** gì về route `/auth/me`. Guard chỉ hỏi 1 câu duy nhất qua gRPC: "token này còn hợp lệ không, của ai?". Nhờ vậy **mọi service khác** sau này (product, order) đều dùng lại cùng 1 guard để bảo vệ route mà không cần tự verify JWT.

### 3.4. `POST /auth/refresh` — logic bước [5] có thêm Redis

```
[5] refreshToken(refreshToken):
     ├─ this.jwt.verifyAsync(refreshToken)      (hỏng/hết hạn → 401)
     ├─ kiểm payload.type === 'refresh'
     ├─ this.redis.get('refresh:<userId>')  ──► 🔴 Redis
     │      └─ token gửi lên ≠ token đang lưu → RpcException (đã bị thu hồi/xoay vòng) → 401
     └─ issueTokens(...)  → phát CẶP token MỚI + GHI ĐÈ Redis (rotation)
                            → refresh token cũ từ nay vô dụng
```

---

## 4. Thứ tự đọc file để hiểu Day 2 (đề xuất)

1. `proto/auth.proto` — ôn lại hợp đồng (giống Day 1).
2. `auth-service/src/auth/user.entity.ts` — bảng `users` trông thế nào (dễ nhất).
3. `auth-service/src/auth/auth.service.ts` — **đọc kỹ nhất**, toàn bộ logic ở đây.
4. `auth-service/src/redis/redis.service.ts` — cách lưu refresh token.
5. `auth-service/src/app.module.ts` — cách wire TypeORM + JwtModule + Redis (mục 5 giải thích).
6. `api-gateway/src/auth-client/dto/auth.dto.ts` — luật validate input.
7. `api-gateway/src/auth-client/auth.controller.ts` — REST endpoint + try/catch đổi lỗi.
8. `api-gateway/src/auth-client/jwt-auth.guard.ts` — cách bảo vệ route.
9. `api-gateway/src/common/rpc-to-http.ts` — map lỗi gRPC → HTTP.

---

## 5. Giải thích `app.module.ts` của auth-service (phần wiring mới)

Đây là nơi khác monolith nhiều nhất về mặt cấu hình. 3 khối `imports`:

- **`ConfigModule.forRoot({ isGlobal: true })`** — đọc biến môi trường (`DATABASE_URL`, `JWT_SECRET`, `REDIS_URL`...). `isGlobal` = mọi module khác inject `ConfigService` được mà không cần import lại. (Giống monolith.)

- **`TypeOrmModule.forRootAsync(...)`** — mở kết nối tới Postgres.
  - `forRootAsync` (không phải `forRoot`) vì cần đọc `DATABASE_URL` từ `ConfigService` lúc chạy → phải dùng `useFactory` + `inject`.
  - `entities: [User]` — khai báo entity nào thuộc kết nối này.
  - `migrationsRun: true` — **tự chạy migration đang chờ mỗi lần server khởi động** (xem mục 6).
  - `synchronize: false` — KHÔNG để TypeORM tự sửa bảng theo entity (nguy hiểm cho prod). Thay đổi schema chỉ qua migration.

- **`TypeOrmModule.forFeature([User])`** — "đăng ký repository của `User`" cho module này, để `auth.service.ts` inject được `@InjectRepository(User)`. (Trong monolith bạn cũng viết y hệt.)

- **`JwtModule.registerAsync(...)`** — cấu hình `JwtService` (ký/verify token) với `secret` đọc từ env. Sau đó `auth.service.ts` inject `JwtService` để `signAsync`/`verifyAsync`.

`providers: [AuthService, RedisService]` — `RedisService` được liệt kê ở đây nên NestJS tạo 1 instance (constructor của nó tự kết nối Redis từ `REDIS_URL`).

---

## 6. Migration — điều bạn CHƯA gặp ở monolith đơn giản

Trong nhiều dự án monolith nhỏ, người ta bật `synchronize: true` để TypeORM tự tạo/sửa bảng. **Dự án này cố tình KHÔNG dùng** vì nó có thể tự ý DROP cột → mất dữ liệu ở prod. Thay vào đó dùng **migration**: mỗi thay đổi schema là 1 file chứa SQL rõ ràng, có thể review + rollback.

**Cơ chế:**
- File `migrations/<timestamp>-InitAuth.ts` có 2 hàm: `up()` (áp dụng — tạo bảng `users`) và `down()` (hoàn tác — xoá bảng).
- TypeORM tạo 1 bảng `migrations` trong DB để nhớ migration nào đã chạy → không chạy lại lần 2 (idempotent).
- Vì `migrationsRun: true`, mỗi lần auth-service khởi động nó tự chạy migration nào chưa có trong bảng `migrations`. Đó là lý do bạn không phải gõ lệnh gì mà bảng vẫn tự có.

**Lệnh dùng khi bạn SỬA entity** (thêm cột chẳng hạn):
```bash
# 1. Sinh migration mới bằng cách so entity với DB hiện tại
docker compose exec auth-service npm run migration:generate -- src/migrations/TenThayDoi
# 2. Áp dụng (hoặc để service tự chạy khi restart)
docker compose exec auth-service npm run migration:run
# Xem trạng thái / hoàn tác:
docker compose exec auth-service npm run migration:show
docker compose exec auth-service npm run migration:revert
```
> `data-source.ts` chỉ phục vụ mấy lệnh CLI trên — **không** chạy khi server bật bình thường.
> File migration **phải commit vào git**: đây là nguồn tạo schema, khi deploy prod sẽ chạy đúng các file này.

---

## 7. Vì sao tách token thành access + refresh, và Redis để làm gì

- **Access token (15 phút)**: gửi kèm mỗi request (header `Authorization: Bearer`). Ngắn hạn để nếu lộ thì kẻ xấu chỉ dùng được 15 phút. Server **không lưu** access token — chỉ cần verify chữ ký là đủ (stateless).
- **Refresh token (7 ngày)**: chỉ dùng để xin access token mới khi access hết hạn. Vì sống lâu nên phải **lưu server-side (Redis)** để có thể **thu hồi** — nếu chỉ verify chữ ký như access thì không cách nào vô hiệu 1 token trước hạn.
- **Redis** hợp cho việc này vì: tra cứu cực nhanh (in-memory) và có **TTL tự hết hạn** (set key sống đúng 7 ngày, hết hạn Redis tự xoá).
- **Rotation**: mỗi lần refresh, ta phát cặp token mới VÀ ghi đè Redis → token cũ dùng lại sẽ bị từ chối (phát hiện token bị đánh cắp/dùng lại).

> ⚠️ Thiết kế hiện tại lưu **1 refresh token / user** (`refresh:<userId>`). Nghĩa là đăng nhập ở máy thứ 2 sẽ đá phiên máy thứ 1. Đủ cho dự án học; muốn multi-device thì lưu theo `jti` (id riêng mỗi token) thay vì theo user.

---

## 8. Tóm tắt: cái gì KHÔNG đổi, cái gì MỚI (so với monolith)

**Không đổi (bạn đã biết):**
- Pattern Controller (mỏng) / Service (logic dày), Dependency Injection qua constructor.
- `@InjectRepository(User)` + TypeORM repository (`findOne`, `save`) — y hệt monolith.
- `class-validator` + DTO + `ValidationPipe` — y hệt cách validate REST bạn từng làm.
- Guard (`CanActivate`) — khái niệm guard giống monolith.

**Mới trong Day 2:**
- Logic "thật" bị **xé làm đôi qua network**: controller REST ở gateway → (gRPC) → controller gRPC + service ở auth-service. 1 request đi qua 2 process (xem flow chart mục 3).
- Guard **không tự verify JWT tại chỗ** mà gọi `ValidateToken` sang service khác qua gRPC — để logic auth tập trung 1 nơi.
- Lỗi phải **dịch 2 lần**: `RpcException` (mã gRPC) → `rpc-to-http.ts` → `HttpException` (mã HTTP).
- Refresh token có **trạng thái server-side** (Redis) thay vì stateless như access token.
- Schema DB quản lý bằng **migration** thay vì `synchronize`.

---

## 9. Gợi ý thực hành để hiểu sâu (tự làm, không cần hỏi)

1. `docker compose logs -f api-gateway auth-service` song song, rồi chạy curl register — đọc log 2 bên để thấy request "nhảy" từ process này sang process kia.
2. `docker compose stop redis` rồi thử `/auth/refresh` — sẽ lỗi, chứng minh refresh phụ thuộc Redis (còn `/auth/login` vẫn chạy vì không đọc Redis lúc verify).
3. Đăng nhập lấy access token, đợi >15 phút rồi gọi `/auth/me` — sẽ 401 (token hết hạn), sau đó dùng `/auth/refresh` xin token mới.
4. Mở `psql` xem 2 bảng: `SELECT * FROM users;` và `SELECT * FROM migrations;` để thấy dữ liệu thật + lịch sử migration.
5. Sửa `user.entity.ts` thêm 1 cột (vd `displayName`), chạy `migration:generate` để xem TypeORM tự sinh SQL `ALTER TABLE` — cảm nhận vì sao migration an toàn hơn `synchronize`.
