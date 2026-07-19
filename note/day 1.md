# Day 1 — Từ Monolith NestJS sang Microservices (gRPC)

> Đọc file này 1 lần từ trên xuống, theo đúng thứ tự — không cần đọc code trước.
> Giả định: bạn đã quen `@Controller`, `@Injectable`, `@Module`, Dependency Injection trong 1 app NestJS monolith (REST API). File này chỉ tập trung vào **cái gì KHÁC** so với những gì bạn đã biết.

---

## 1. Khác biệt cốt lõi so với monolith bạn đang quen

| | Monolith REST (bạn đã quen) | Microservices Day 1 (dự án này) |
|---|---|---|
| Số process chạy | 1 process Node duy nhất | Nhiều process/container độc lập (mỗi service 1 cái) |
| Controller gọi Service | Gọi **hàm trong cùng bộ nhớ** (`this.userService.findOne()`) | Controller ở service A gọi sang Service ở service B **qua network** (gRPC) |
| Bootstrap | `NestFactory.create(AppModule)` → mở 1 cổng HTTP | Có 2 kiểu: `NestFactory.create()` (mở HTTP, như cũ) **hoặc** `NestFactory.createMicroservice()` (mở gRPC, KHÔNG có HTTP) |
| "Hợp đồng" API | Bạn tự định nghĩa DTO + Swagger (nếu có) | Bắt buộc có file `.proto` — định nghĩa method + shape dữ liệu, dùng chung cho cả 2 phía |
| Gọi sang "chỗ khác" | Import thẳng Service, dùng luôn | Phải đăng ký `ClientsModule`, lấy ra 1 **object proxy** giả lập, gọi lên nó thì mới thực sự bắn request qua mạng |
| Kiểu trả về khi gọi | `Promise` (`async/await` bình thường) | `Observable` (RxJS) — phải `firstValueFrom()` để đổi sang `Promise` |
| DB | 1 DB dùng chung cho cả app | Mỗi service 1 DB riêng (database-per-service) — chưa làm ở Day 1 |

Điểm quan trọng nhất cần khắc vào đầu: **2 service này là 2 process khác nhau, nói chuyện qua network bằng gRPC (giao thức nhị phân dựa trên protobuf)**, không phải gọi hàm JS bình thường như bạn vẫn làm trong monolith. `.proto` là "hợp đồng" định nghĩa tên method + hình dạng dữ liệu để 2 bên hiểu nhau, dù code khác project (giống vai trò của Swagger/OpenAPI bên REST, nhưng bắt buộc và chặt hơn).

---

## 2. Day 1 đã dựng cái gì

2 service NestJS, nói chuyện qua gRPC:

```
curl :3000/auth/ping
        │  (HTTP — giống hệt monolith bạn quen)
        ▼
┌─────────────────────────┐          ┌──────────────────────────┐
│   Container api-gateway  │          │   Container auth-service │
│                           │          │                          │
│ AuthController.ping()     │          │                          │
│   → authClientService     │  gRPC    │                          │
│     .ping()                │◄──────► │ AuthController           │
│     → gọi "ValidateToken"  │ (network,│   .validateToken()      │
│       trên object PROXY    │  không   │   → AuthService          │
│       (không phải hàm JS   │  phải    │     .validateToken()    │
│       nội bộ!)             │  hàm JS) │     (business logic,    │
│                           │          │      Day 1 = data giả)   │
│                           │  ◄────── │  trả về { valid,         │
│                           │           │  userId, email }        │
│  ← Observable → Promise   │          │                          │
│  ← trả JSON cho client     │          │                          │
└─────────────────────────┘          └──────────────────────────┘
```

- `api-gateway`: app HTTP **y hệt monolith bạn từng làm** — có `@Controller`, `@Get`. Có 2 route:
  - `GET /health` — không liên quan gRPC gì cả, chỉ để test container còn sống.
  - `GET /auth/ping` — route HTTP bình thường, nhưng bên trong nó gọi sang `auth-service` qua gRPC.
- `auth-service`: **KHÔNG có route HTTP nào cả**. Đây là điểm lạ nhất với người quen monolith — app này chỉ mở 1 cổng gRPC (`50051`), không có `app.listen(port)` kiểu HTTP.
- Logic trong `auth.service.ts` mới là **data giả** (stub) — mục tiêu Day 1 chỉ để chứng minh 2 process nói chuyện qua gRPC thành công. Chưa có DB, chưa có JWT thật.

---

## 3. Thứ tự đọc file (đi từ hợp đồng → server → client)

### Bước 1 — đọc "hợp đồng" trước tiên: `proto/auth.proto`

Đây là nguồn sự thật duy nhất, giống vai trò 1 file Swagger nhưng chặt hơn — định nghĩa 4 method: `Register`, `Login`, `ValidateToken`, `RefreshToken`.

**Chú ý quan trọng nhất khi mới học gRPC**: proto khai báo field kiểu `snake_case` (`access_token`, `user_id`), nhưng khi `@grpc/proto-loader` load vào JS, nó **tự động chuyển sang `camelCase`** (`accessToken`, `userId`). Đó là lý do trong code TypeScript của cả 2 service bạn sẽ thấy `accessToken` chứ không phải `access_token`. Không có ai gõ tay chuyển đổi cả — thư viện tự làm.

### Bước 2 — đọc `auth-service` (phía "server", đơn giản hơn vì không có REST layer)

1. **`services/auth-service/src/main.ts`** — điểm khác biệt lớn nhất so với app bạn quen:
   ```ts
   NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
     transport: Transport.GRPC,
     options: { package: 'auth', protoPath: getProtoPath('auth.proto'), url: process.env.GRPC_URL ?? '0.0.0.0:50051' },
   })
   ```
   Không phải `NestFactory.create()` + `app.listen(3000)` như bạn từng viết. App này không mở cổng HTTP nào cả, chỉ mở 1 cổng gRPC.

2. **`services/auth-service/src/app.module.ts`** — y hệt monolith: khai báo controller/provider nào được dùng. Không có gì mới.

3. **`services/auth-service/src/auth/auth.controller.ts`** — đây là chỗ thay thế cho `@Get()`/`@Post()` mà bạn quen:
   ```ts
   @GrpcMethod('AuthService', 'ValidateToken')
   validateToken(data: ValidateTokenRequest): ValidateTokenResponse { ... }
   ```
   Thay vì route theo HTTP verb + path, Nest route request gRPC đến đúng hàm dựa vào **2 chuỗi trong decorator** (`'AuthService'` = tên service trong proto, `'ValidateToken'` = tên rpc trong proto) — **không phải theo tên hàm TypeScript**. Bạn có thể đặt tên hàm TS là gì cũng được, miễn 2 string đó đúng.

4. **`services/auth-service/src/auth/auth.service.ts`** — business logic thật, y hệt pattern Service bạn quen (Controller mỏng nhận request, Service xử lý logic). Ở Day 1 mới trả `stub-access-token` cố định; Day 2 sẽ thay bằng hash password/JWT/DB thật.

5. **`services/auth-service/src/auth/auth.interface.ts`** — type khớp 1-1 với proto (đã camelCase), giúp khỏi gõ sai field. Tương đương DTO bạn hay viết cho REST, nhưng ở đây interface phải khớp đúng cấu trúc trong `.proto`.

### Bước 3 — đọc `api-gateway` (phía "client", có phần mới bạn chưa từng gặp)

1. **`src/main.ts`** — `NestFactory.create(AppModule)` + `app.listen(port)`, **giống hệt monolith bạn vẫn viết**. Không có gì lạ ở đây.

2. **`src/app.module.ts`** — import thêm `AuthClientModule`. Vẫn là `@Module` bình thường.

3. **`src/health/health.controller.ts`** — 1 Controller Nest thuần HTTP, chưa dính gRPC gì cả. Đọc để thấy: đúng, `@Controller`/`@Get` vẫn dùng y hệt monolith — chỉ có phần *bên trong* handler mới khác khi cần gọi service khác.

4. **`src/auth-client/auth-client.module.ts`** — **phần hoàn toàn mới, không có tương đương trong monolith**: khai báo "mình là client của auth-service".
   ```ts
   ClientsModule.registerAsync([{
     name: AUTH_CLIENT,
     useFactory: (config) => ({
       transport: Transport.GRPC,
       options: { package: AUTH_PACKAGE_NAME, protoPath: getProtoPath('auth.proto'), url: config.get('AUTH_GRPC_URL', 'localhost:50051') },
     }),
   }])
   ```
   Trong monolith bạn chỉ cần `import { UserService }` rồi inject thẳng. Ở đây không import được `AuthService` của service kia (khác process, khác container) — nên phải đăng ký 1 "kênh kết nối" tới nó qua `ClientsModule`, đọc URL từ env (`AUTH_GRPC_URL`).

5. **`src/auth-client/auth-client.constants.ts`** — định nghĩa interface `AuthGrpcService` mô tả các method gRPC dạng *client* (trả về `Observable` thay vì giá trị thường) — chỉ để TypeScript gõ đúng, không phải logic.

6. **`src/auth-client/auth-client.service.ts`** — chỗ "ảo thuật" nhất với người mới, đọc kỹ:
   ```ts
   onModuleInit() {
     this.authService = this.client.getService<AuthGrpcService>(AUTH_SERVICE_NAME);
   }
   ping() {
     return this.authService.validateToken({ accessToken: 'ping' });
   }
   ```
   `this.client.getService(...)` không trả về instance thật của `AuthService` bên kia — nó trả về 1 **object proxy** do NestJS tự sinh lúc chạy (dựa trên proto đã load), có method trùng tên rpc. Gọi `.validateToken(...)` trên proxy này **thực chất là gửi 1 request gRPC qua mạng** tới `auth-service`, không phải gọi hàm JS nội bộ như bạn quen khi inject Service trong monolith.

7. **`src/auth-client/auth.controller.ts`** — dùng `authClientService`, và bắt buộc:
   ```ts
   const result = await firstValueFrom(this.authClientService.ping());
   ```
   Vì gRPC client trong Nest trả về `Observable` (RxJS), không phải `Promise`. Đây là chỗ khác với `async/await` thuần bạn quen — phải qua `firstValueFrom()` để đổi sang `Promise` rồi mới `await` được.

8. **`src/common/proto-path.util.ts`** — helper phụ tìm đường dẫn file `.proto` (khác nhau giữa dev/prod vì cấu trúc thư mục khác nhau). Không phải logic chính, đọc sau cùng hoặc bỏ qua.

> ⚠️ Có **2 class cùng tên `AuthController`** trong repo — 1 ở `auth-service/src/auth/` (nhận gRPC, phía server), 1 ở `api-gateway/src/auth-client/` (nhận HTTP `/auth/ping`, phía client). Đừng nhầm khi grep code hay hỏi AI.

---

## 4. Build/biên dịch chạy như thế nào

**Chạy dev** (`npm run start:dev` = `nest start --watch`, đang chạy trong container hiện tại — giống hệt cách bạn chạy monolith):
- TypeScript biên dịch trong bộ nhớ (không tạo file `.js` cố định), có `fork-ts-checker-webpack-plugin` check type song song, tự động re-compile + restart khi sửa file `.ts`.
- Khác 1 chỗ so với chạy local thường: `docker-compose.yml` **mount** thư mục `services/<name>` từ máy host thẳng vào container (`volumes:`), nên `nest --watch` phát hiện file đổi từ host và tự reload — bạn sửa code xong không cần rebuild image.

**Chạy production** (`node dist/main.js`, dùng trong `docker-compose.prod.yml` sau này):
- `nest build` chạy `tsc` thật, biên dịch toàn bộ `.ts` → `.js` vào `dist/`. Không type-check lúc runtime nữa (đã check ở bước build).
- `Dockerfile` (mẫu dùng chung cho mọi service, đổi `SERVICE_DIR` khi copy sang service khác) có 3 stage tách biệt:
  - `dev`: cài full `node_modules`, chạy `start:dev`.
  - `build`: `npm ci` → `nest build` → `npm prune --production` (bỏ hết devDependencies).
  - `production`: chỉ copy `dist/`, `node_modules` đã prune, `proto/` — **không có mã nguồn `.ts`** → image nhẹ hơn nhiều.

**`tsconfig.json`** có 2 flag bắt buộc mà monolith bạn từng dùng cũng cần: `experimentalDecorators` và `emitDecoratorMetadata`. NestJS dùng decorator (`@Controller`, `@Injectable`, `@GrpcMethod`...) kết hợp `reflect-metadata` để tự động biết constructor cần inject gì (Dependency Injection — **phần này không đổi gì so với monolith**, DI vẫn hoạt động y hệt bên trong 1 service). Thiếu 2 flag này thì lúc build, decorator "vỡ" hàng loạt.

---

## 5. Tóm tắt: cái gì KHÔNG đổi, cái gì MỚI

**Không đổi (bạn đã biết rồi):**
- `@Module`, `@Injectable`, Dependency Injection qua constructor.
- `@Controller` + `@Get`/`@Post` vẫn dùng bình thường ở `api-gateway` (nơi duy nhất nhận REST).
- Tách Controller (nhận request, trả response) / Service (logic thật) — pattern giữ nguyên trong từng service riêng lẻ.

**Mới (lần đầu gặp trong dự án này):**
- `NestFactory.createMicroservice()` thay vì `.create()` cho service không có HTTP.
- File `.proto` làm hợp đồng bắt buộc giữa 2 service (khác ngôn ngữ, khác project vẫn hiểu nhau được).
- `@GrpcMethod('ServiceName', 'MethodName')` thay cho `@Get`/`@Post`.
- `ClientsModule` + `client.getService()` để lấy 1 **proxy object** gọi sang service khác qua network — không import Service trực tiếp được nữa.
- Kết quả gọi gRPC là `Observable`, phải `firstValueFrom()` mới `await` được.

---

## 6. Gợi ý thực hành để hiểu sâu hơn (không cần hỏi thêm)

1. `docker compose stop auth-service` rồi `curl :3000/auth/ping` — sẽ thấy lỗi kết nối gRPC, chứng minh 2 service thực sự tách rời qua network (khác hẳn cảm giác gọi hàm nội bộ trong monolith).
2. Sửa `services/auth-service/src/auth/auth.service.ts` (đổi giá trị trả về của `validateToken`), lưu file, xem log `auth-service` tự recompile, rồi `curl` lại `/auth/ping` — thấy đổi ngay, không cần rebuild image.
3. Chạy `docker compose logs -f api-gateway auth-service` song song lúc `curl`, để thấy rõ log 2 bên "nói chuyện" với nhau qua network.
