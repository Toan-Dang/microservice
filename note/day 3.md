# Day 3 — Product Service (service thứ 2 có DB riêng + tái dùng guard)

> Đọc file này từ trên xuống. Giả định bạn đã đọc `note/day 2.md` (hiểu gRPC 2 process, TypeORM, migration, `JwtAuthGuard`).
> Day 2 xây **auth-service** hoàn chỉnh. Day 3 lặp lại đúng công thức đó cho **product-service** — nhưng lần này bạn sẽ thấy cái hay của microservice: DB **tách hẳn** (`product_db`), và guard viết ở Day 2 được **tái dùng nguyên vẹn** để bảo vệ route mới mà không viết lại dòng auth nào.

---

## 1. Day 3 thêm gì so với Day 2

| | Day 2 | Day 3 |
|---|---|---|
| Service mới | auth-service | **product-service** (gRPC, cổng `:50052`) |
| Database | `auth_db` (bảng `users`) | **`product_db`** riêng biệt (bảng `products`) — database-per-service |
| Entity | `User` | `Product` (id, name, price, stock) |
| gRPC methods | Register/Login/ValidateToken/RefreshToken | **Create / FindOne / FindMany / CheckStock** |
| Phân trang | Không có | `FindMany(page, limit)` dùng `findAndCount` |
| Seed dữ liệu | Không | **Seed 5 sản phẩm** khi bảng rỗng (hook `OnApplicationBootstrap`) |
| api-gateway REST | `/auth/*` | thêm **`/products`** (GET list, GET :id, POST create) |
| Bảo vệ route | `JwtAuthGuard` (mới viết) | **tái dùng** `JwtAuthGuard` của Day 2 cho `POST /products` |
| Lỗi gRPC→HTTP | `rpc-to-http.ts` (mới viết) | **tái dùng** `rpc-to-http.ts` |

**Ý tưởng cốt lõi để khắc vào đầu:** product-service **không biết gì về JWT/auth**. Nó chỉ lo dữ liệu sản phẩm. Việc "ai được phép POST tạo sản phẩm" do **gateway** quyết định bằng `JwtAuthGuard` — guard này lại đi hỏi **auth-service** qua gRPC. 3 service, mỗi cái một việc, ghép lại bằng gRPC. Đây chính là điểm khác biệt lớn nhất so với monolith: **thêm tính năng = thêm service độc lập, tái dùng phần chung có sẵn.**

---

## 2. Các file mới của Day 3 (và vai trò)

### product-service (service mới — bản sao cấu trúc auth-service)
```
services/product-service/
├── Dockerfile, package.json, tsconfig*, nest-cli.json,   # copy từ auth-service,
│   eslint.config.mjs, .prettierrc                         # đổi tên + bỏ dep jwt/bcrypt/redis
└── src/
    ├── main.ts                        # bootstrap gRPC, package 'product', cổng 50052
    ├── app.module.ts                  # wire TypeORM (product_db) — KHÔNG có Jwt/Redis
    ├── data-source.ts                 # cho TypeORM CLI (giống Day 2)
    ├── common/proto-path.util.ts      # copy y hệt Day 1/2 (tìm file proto)
    ├── product/
    │   ├── product.controller.ts      # 4 @GrpcMethod khớp proto/product.proto
    │   ├── product.service.ts         # ⭐ logic: create/findOne/findMany/checkStock + seed
    │   ├── product.entity.ts          # entity TypeORM = bảng "products"
    │   ├── product.interface.ts       # type khớp proto (giống auth.interface.ts)
    │   └── product.service.spec.ts    # unit test CheckStock
    └── migrations/
        └── <timestamp>-InitProduct.ts # SQL tạo bảng products
```

### api-gateway (thêm 1 nhóm "client của product-service")
```
services/api-gateway/src/
├── app.module.ts                      # (đổi) import thêm ProductClientModule
└── product-client/                    # MỚI — song song với auth-client/
    ├── product.controller.ts          # REST /products (GET list, GET :id, POST create)
    ├── product-client.service.ts      # gọi proxy gRPC (findMany/findOne/create)
    ├── product-client.module.ts       # đăng ký ClientGrpc + import AuthClientModule (lấy guard)
    ├── product-client.constants.ts    # tên package/service + interface gRPC
    └── dto/product.dto.ts             # CreateProductDto, FindManyQueryDto (class-validator)
```

> Để ý: `product-client/` là **bản sao cấu trúc** của `auth-client/` ở Day 2. Nếu bạn hiểu `auth-client/` rồi thì đọc cái này rất nhanh — chỉ khác tên message và có thêm phân trang.

---

## 3. FLOW CHART — mỗi request đi qua những file nào

> Quy ước giống Day 2: `│`/`▼` đi sâu vào; `▲` trả ngược lên; `═══` = ranh giới NETWORK (2 process khác nhau).

### 3.1. `GET /products?page=1&limit=3` (list phân trang — KHÔNG cần token)

```
   curl GET localhost:3000/products?page=1&limit=3
        │  (HTTP)
        ▼
╔══════════════════════════ PROCESS 1: api-gateway (:3000) ════════════════════════════════╗
║  [1] main.ts (chạy sẵn) → ValidationPipe so query với FindManyQueryDto                     ║
║        📄 product-client/dto/product.dto.ts  (page/limit phải là int ≥ 1 nếu có)          ║
║       │  hợp lệ                                                                             ║
║       ▼                                                                                     ║
║  [2] 📄 product-client/product.controller.ts → list(query)                                 ║
║        → mặc định page=1, limit=10 nếu client không truyền                                  ║
║       ▼                                                                                      ║
║  [3] 📄 product-client/product-client.service.ts → findMany(page, limit)                   ║
║        → this.productService.findMany({page,limit})  ← PROXY gRPC                          ║
║        → firstValueFrom(...) đổi Observable → Promise                                       ║
║       ▼  ❗ BẮN request gRPC qua mạng                                                        ║
╚═══════════════════════════════════════│═══════════════════════════════════════════════════╝
              ═══════════════ gRPC ═══════════════
                                         │
╔═══════════════════════════════════════▼═══ PROCESS 2: product-service (:50052) ═══════════╗
║  [4] 📄 product/product.controller.ts → @GrpcMethod('ProductService','FindMany')          ║
║  [5] 📄 product/product.service.ts → findMany(page, limit):                                ║
║        ├─ clamp: page<1→1, limit<1→10, limit>100→100  (chặn client xin quá nhiều)         ║
║        ├─ this.products.findAndCount({ skip:(page-1)*limit, take:limit, order })           ║
║        │        └─► TypeORM sinh SQL SELECT + COUNT ─► ═══TCP═══► 🗄 product_db            ║
║        └─ trả { products:[...], total }                                                     ║
║        ▲                                                                                     ║
╚═══════════════════════════════════════│═══════════════════════════════════════════════════╝
              ═══════════════ gRPC trả về ═══════════════
                                         │
╔═══════════════════════════════════════▼═══ PROCESS 1: api-gateway ════════════════════════╗
║  [6] product-client.service.ts resolve → controller bọc lại                                ║
║  [7] product.controller.ts → return { data, total, page, limit }  → JSON 200               ║
╚═══════════════════════════════════════════════════════════════════════════════════════════╝
```

### 3.2. `GET /products/:id` — giống hệt, chỉ đổi method

Đường đi `[1]→...→[7]` y hệt 3.1, chỉ khác:
```
[5] findOne(id):
     ├─ this.products.findOne({ where:{ id } })  ─► SELECT ... WHERE id = $1
     └─ KHÔNG thấy → throw RpcException(NOT_FOUND, 'Sản phẩm không tồn tại')
              └─ chui ngược qua gRPC → 📄 common/rpc-to-http.ts đổi code 5 → HTTP 404
```

### 3.3. `POST /products` — route ĐƯỢC BẢO VỆ (điểm học chính của Day 3)

Đây là chỗ thấy rõ **tái dùng auth**: guard Day 2 chen vào **trước** controller, và nó gọi **sang auth-service** (process thứ 3!) để xác thực.

```
   curl POST localhost:3000/products  -H "Authorization: Bearer <access_token>"
        -d '{"name":"Webcam 4K","price":1590000,"stock":25}'
        │
        ▼
╔══════════════════════════ PROCESS 1: api-gateway ═════════════════════════════════════════╗
║  [1] Route /products POST có @UseGuards(JwtAuthGuard) → CHẠY GUARD TRƯỚC                    ║
║       📄 auth-client/jwt-auth.guard.ts → canActivate()   ← ❗ file của DAY 2, tái dùng     ║
║        ├─ tách "Bearer <token>" (thiếu → 401 ngay)                                          ║
║        └─ authClientService.validateToken(token) ─► proxy gRPC sang AUTH-SERVICE            ║
║             │                                                                                ║
║  ═══════════│═══ gRPC ═══► PROCESS 3: auth-service (:50051) → ValidateToken → {valid,...}   ║
║             ▲                                                                                ║
║        ├─ valid=false → UnauthorizedException → 401  (controller product KHÔNG chạy)       ║
║        └─ valid=true  → gắn req.user, cho qua                                                ║
║       ▼                                                                                       ║
║  [2] main.ts ValidationPipe so body với CreateProductDto                                    ║
║        📄 product-client/dto/product.dto.ts (name không rỗng, price≥0, stock≥0 int)        ║
║        → sai → 400 (chưa gọi product-service)                                                ║
║       ▼                                                                                       ║
║  [3] 📄 product-client/product.controller.ts → create(dto)                                  ║
║  [4] 📄 product-client.service.ts → create(name,price,stock) ─► PROXY gRPC                  ║
╚═══════════════════════════════════════│═══════════════════════════════════════════════════╝
              ═══════════════ gRPC ═══════════════ (sang PROCESS 2)
                                         │
╔═══════════════════════════════════════▼═══ PROCESS 2: product-service ════════════════════╗
║  [5] 📄 product.controller.ts → @GrpcMethod Create                                          ║
║  [6] 📄 product.service.ts → create(data):                                                  ║
║        ├─ validate lần 2 (phòng thủ, vì order-service sau này gọi thẳng không qua DTO)     ║
║        ├─ this.products.save(create({name,price,stock})) ─► INSERT ─► 🗄 product_db        ║
║        └─ trả { id, name, price, stock }                                                     ║
║        ▲                                                                                      ║
╚═══════════════════════════════════════│═══════════════════════════════════════════════════╝
              ═══════════════ gRPC trả về ═══════════════
                                         │
╔═══════════════════════════════════════▼═══ PROCESS 1 ═════════════════════════════════════╗
║  [7] product.controller.ts → return object → JSON 201                                       ║
╚═══════════════════════════════════════════════════════════════════════════════════════════╝
```

> **Đây là bức tranh microservice đầy đủ nhất tới giờ:** 1 request `POST /products` chạm vào **CẢ 3 process** — gateway (nhận REST) → auth-service (xác thực token) → product-service (ghi DB). Không service nào biết toàn bộ; gateway là nhạc trưởng.

### 3.4. `CheckStock` — CHỈ gọi bằng gRPC, KHÔNG có REST

`CheckStock` không map ra REST vì nó dành cho **order-service** (Day 4) gọi trước khi tạo đơn:
```
(Day 4) order-service.CreateOrder
   └─► productService.checkStock({ productId, quantity })  ═══ gRPC ═══► product-service
          📄 product.service.ts → checkStock(productId, quantity):
            ├─ findOne(productId)  → không có → RpcException NOT_FOUND
            └─ trả { available: stock >= quantity && quantity>0,
                     price:     giá hiện tại,
                     remaining: stock hiện tại (KHÔNG trừ — xem mục 7) }
```
> Vì chưa có REST, Day 3 kiểm `CheckStock` bằng **unit test** (`product.service.spec.ts`) thay vì curl. Đó là lý do đề bài yêu cầu "vài unit test cho CheckStock".

---

## 4. Thứ tự đọc file để hiểu Day 3 (đề xuất)

1. `proto/product.proto` — hợp đồng: 4 rpc + message. Chú ý `product_id` (snake_case).
2. `product-service/src/product/product.entity.ts` — bảng `products` (dễ nhất).
3. `product-service/src/product/product.service.ts` — **đọc kỹ nhất**: 4 method + seed.
4. `product-service/src/app.module.ts` — wire TypeORM (so với Day 2: **thiếu** Jwt & Redis).
5. `product-service/src/product/product.service.spec.ts` — cách test CheckStock bằng repo giả.
6. `api-gateway/src/product-client/dto/product.dto.ts` — luật validate input.
7. `api-gateway/src/product-client/product.controller.ts` — REST + chỗ gắn `@UseGuards`.
8. `api-gateway/src/product-client/product-client.module.ts` — cách **import AuthClientModule** để mượn guard.

---

## 5. Giải thích `app.module.ts` của product-service (so sánh với Day 2)

Gần **giống hệt** auth-service, nhưng **đơn giản hơn** vì product không cần token/redis:

```ts
imports: [
  ConfigModule.forRoot({ isGlobal: true }),      // đọc env DATABASE_URL, GRPC_URL
  TypeOrmModule.forRootAsync({ ...product_db }),  // kết nối product_db, migrationsRun:true, synchronize:false
  TypeOrmModule.forFeature([Product]),            // để inject Repository<Product>
],
controllers: [ProductController],
providers: [ProductService],
```

**Khác Day 2 ở đâu:**
- ❌ **Không** `JwtModule` — product-service không phát/verify token.
- ❌ **Không** `RedisService` — không lưu gì trong Redis.
- ✅ Còn lại giống hệt: `forRootAsync` (đọc `DATABASE_URL` lúc chạy), `migrationsRun: true` (tự chạy migration khi boot), `synchronize: false` (schema chỉ đổi qua migration — xem lại Day 2 mục 6).

`package.json` cũng bỏ các dependency `@nestjs/jwt`, `bcrypt`, `ioredis` tương ứng.

---

## 6. Những cái MỚI về mặt kỹ thuật ở Day 3

### 6.1. Seed dữ liệu bằng `OnApplicationBootstrap`
```ts
export class ProductService implements OnApplicationBootstrap {
  async onApplicationBootstrap() {
    if (await this.products.count() > 0) return;   // đã có data → bỏ qua
    await this.products.save(SEED_PRODUCTS.map(p => this.products.create(p)));
  }
}
```
- `OnApplicationBootstrap` là **lifecycle hook** của NestJS: chạy **1 lần** sau khi mọi module init xong (và **sau** khi migration đã tạo bảng). Đây là chỗ đúng để seed — nếu seed trong constructor sẽ lỗi vì bảng có thể chưa tồn tại.
- Idempotent: chỉ seed khi `count() === 0`, nên restart container nhiều lần **không** nhân đôi dữ liệu.

### 6.2. Phân trang với `findAndCount`
`findAndCount` trả 1 lượt cả `[danh_sách, tổng_số]` → đủ cho client biết có bao nhiêu trang. `skip = (page-1)*limit`, `take = limit`. Có **clamp** `limit ≤ 100` để 1 client không thể xin 1 triệu bản ghi làm sập DB.

### 6.3. `price` kiểu `double precision`
Proto khai `double price`. Trong entity dùng `@Column({ type: 'double precision' })` để TypeORM trả về **number** JS (nếu dùng `decimal`/`numeric` TypeORM trả **string**, phải parse thêm). Đủ cho dự án học; tiền thật production nên dùng số nguyên (đơn vị "đồng/xu") để tránh sai số dấu phẩy động.

### 6.4. Tái dùng module chéo để mượn guard
`POST /products` cần `JwtAuthGuard`, mà guard này sống trong `auth-client/` và phụ thuộc `AuthClientService`. Cách nối:
```ts
// product-client.module.ts
imports: [ AuthClientModule, ClientsModule.registerAsync([...product...]) ]
```
`AuthClientModule` (Day 2) đã `exports: [AuthClientService, JwtAuthGuard]`, nên chỉ cần **import** nó là dùng được guard — **không viết lại** một dòng auth nào. Đây là lợi ích lớn của việc chia module rõ ràng từ Day 2.

### 6.5. snake_case ↔ camelCase qua gRPC
Proto ghi `product_id`, nhưng phía TypeScript nhận `productId`. Lý do: `@nestjs/microservices` dùng proto-loader với `keepCase` mặc định = false → tự đổi snake_case sang camelCase. (Giống Day 2: `access_token` → `accessToken`.) Vì vậy `product.interface.ts` khai `productId`, không phải `product_id`.

---

## 7. Ngữ nghĩa `CheckStock.remaining` (ghi rõ để Day 4 không nhầm)

```
CheckStock(product_id, quantity) → { available, price, remaining }
```
- `available` = `quantity > 0 && stock >= quantity` — còn đủ hàng cho số lượng hỏi.
- `price` = giá **hiện tại** của sản phẩm (để order-service tính `total`, không tin giá client gửi).
- `remaining` = **tồn kho hiện tại** (`product.stock`), **KHÔNG** trừ `quantity`.

> Vì sao không trừ? Vì `CheckStock` chỉ **kiểm tra**, không phải **đặt hàng**. Việc trừ kho sẽ do luồng tạo đơn ở Day 4 xử lý (và phải tính chuyện tương tranh — 2 người mua cùng lúc). Tách "kiểm tra" khỏi "trừ" giúp method này không gây tác dụng phụ, gọi bao nhiêu lần cũng an toàn.

---

## 8. Tóm tắt: cái gì LẶP LẠI, cái gì MỚI (so với Day 2)

**Lặp lại y hệt Day 2 (bạn đã biết → làm nhanh):**
- Cấu trúc service gRPC: `main.ts` (createMicroservice) → `app.module.ts` → controller (`@GrpcMethod`) → service → entity.
- TypeORM + migration + `migrationsRun` + `synchronize:false`.
- Cấu trúc "client" ở gateway: module `registerAsync` ClientGrpc → service (proxy + `firstValueFrom`) → controller REST → DTO.
- Map lỗi gRPC → HTTP bằng `rpc-to-http.ts` (dùng lại nguyên).

**Mới ở Day 3:**
- Service thứ 2 với **DB tách hẳn** (`product_db`) — chứng minh database-per-service.
- 1 request `POST /products` chạm **3 process** (gateway → auth → product) nhờ **tái dùng** guard.
- Lifecycle hook `OnApplicationBootstrap` để **seed** dữ liệu.
- **Phân trang** (`findAndCount` + clamp) và kiểu `double precision`.
- Method `CheckStock` **chỉ gRPC, không REST** → kiểm bằng **unit test**.

---

## 9. Gợi ý thực hành để hiểu sâu (tự làm)

1. `docker compose logs -f api-gateway auth-service product-service` (3 cửa sổ) rồi `POST /products` có token — xem request "nhảy" gateway → auth (validate) → product (insert).
2. `docker compose exec postgres psql -U app -d product_db -c 'SELECT * FROM products;'` — thấy 5 sản phẩm seed. Rồi thử `\l` xem `product_db` **tách riêng** `auth_db` (không có bảng `users` trong `product_db`).
3. `docker compose restart product-service` rồi xem log: KHÔNG thấy "Đã seed..." lần 2 (vì bảng đã có data) — chứng minh seed idempotent.
4. Gọi `POST /products` **không** token → 401; **sai** token → 401; body `price: -5` → 400. Đối chiếu xem lỗi nào do guard, lỗi nào do ValidationPipe.
5. Chạy `npm test` trong `services/product-service` và mở `product.service.spec.ts`: xem cách test dùng **repo giả bằng Map** (không cần DB thật) để kiểm logic `CheckStock` — kỹ thuật test service tách khỏi hạ tầng.
6. (Chuẩn bị Day 4) Đọc `proto/order.proto` và để ý order-service sẽ gọi `CheckStock` — hình dung nó ghép vào flow `CreateOrder` thế nào.
