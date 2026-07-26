# CLAUDE.md — Định hướng cho Claude Code CLI

> Đặt file này ở gốc repo. Claude Code CLI đọc tự động để hiểu bối cảnh dự án.

## Dự án
E-commerce microservices để học. Monorepo, mỗi service là 1 ứng dụng NestJS độc lập trong `services/`.

## Nguyên tắc kiến trúc (BẮT BUỘC tuân theo)
- **Database-per-service**: mỗi service chỉ truy cập database của chính nó. KHÔNG query chéo DB.
- **Sync = gRPC**: api-gateway ↔ các service, và order-service → product-service dùng gRPC. Proto ở `proto/`.
- **Async = RabbitMQ**: order-service **publish** event; notification-worker **consume**. Không gọi trực tiếp.
- **api-gateway** là nơi DUY NHẤT nhận REST từ client và xử lý JWT guard.
- **api-gateway** áp `ThrottlerGuard` (`@nestjs/throttler`) **global** qua `APP_GUARD` — chống bot/script quét spam các route public (không JWT) như `GET /products`. Cấu hình qua env `THROTTLE_TTL_MS` / `THROTTLE_LIMIT` (mặc định 20 request/10s/IP). Route hạ tầng (vd `/health`) đánh dấu `@SkipThrottle()`. Đây là rate-limit theo IP, KHÔNG phải cơ chế xác thực — không thay thế JWT guard cho route cần biết danh tính user.
- Không service nào expose REST ra ngoài trừ api-gateway.

## Tech & convention
- NestJS + TypeScript, `@nestjs/microservices` (gRPC + RMQ transport).
- ORM: TypeORM (hoặc Prisma — chọn 1 và giữ nhất quán). Migration bật sẵn.
- Config qua `@nestjs/config`, đọc từ biến môi trường (xem docker-compose).
- Validation bằng `class-validator` ở DTO của api-gateway.
- Mọi query có **phân trang** phải sort trên tổ hợp cột **unique** (vd `order: { createdAt: 'ASC', id: 'ASC' }`). Thiếu tie-breaker thì các dòng trùng giá trị sort có thứ tự không xác định → page trả trùng/bỏ sót bản ghi.
- Mỗi service có: `Dockerfile` (copy từ mẫu, đổi `SERVICE_DIR`), `package.json` với script `start:dev`, `build`, `test`, `lint`.
- Test bằng Jest. Mỗi service có ít nhất vài unit test cho business logic.

## Cấu trúc mỗi service
```
services/<name>/
├── src/
│   ├── main.ts          # bootstrap microservice (gRPC listen hoặc RMQ consumer)
│   ├── app.module.ts
│   ├── database/        # HẠ TẦNG DB (không chứa entity)
│   │   ├── data-source.ts       # DataSource cho TypeORM CLI + npm run seed
│   │   ├── migrations/          # chỉ thay đổi SCHEMA
│   │   └── seeds/               # dữ liệu mẫu (xem mục Seed bên dưới)
│   ├── entities/        # DOMAIN MODEL, gom 1 chỗ (xem mục Entity bên dưới)
│   │   ├── <name>.entity.ts
│   │   └── index.ts             # export ENTITIES = [...] + re-export từng entity
│   └── <feature>/       # controller (gRPC handler) + service + dto
├── test/                # TOÀN BỘ test ở đây, KHÔNG để *.spec.ts trong src/
│   ├── unit/            # mirror đúng cấu trúc src/
│   └── e2e/             # chỉ service nào có e2e (hiện tại: api-gateway)
├── package.json
├── tsconfig.json
└── Dockerfile
```

## Test (BẮT BUỘC)
- Không đặt `*.spec.ts` trong `src/`. Unit test ở `test/unit/`, **mirror đúng đường dẫn** trong `src/` (vd `src/product/product.service.ts` → `test/unit/product/product.service.spec.ts`).
- E2E ở `test/e2e/`, đặt tên `*.e2e-spec.ts`, chạy bằng config riêng `test/jest-e2e.json`.
- Jest config trong `package.json` phải là: `rootDir: "."`, `testRegex: "test/unit/.*\\.spec\\.ts$"`, `collectCoverageFrom: ["src/**/*.(t|j)s"]`, `coverageDirectory: "./coverage"`.
- **Lý do `testRegex` phải trỏ thẳng `test/unit/`:** pattern `.*\.spec\.ts$` cũng khớp `*.e2e-spec.ts`, nên nếu để chung thì `npm test` sẽ chạy luôn e2e.

## Entity (BẮT BUỘC)
- Entity nằm ở `src/entities/`, **KHÔNG** để trong feature folder và **KHÔNG** để trong `src/database/` (`database/` chỉ chứa hạ tầng: connection, migration, seed).
- `src/entities/index.ts` là **nguồn duy nhất** khai danh sách entity:
  ```ts
  export const ENTITIES = [Product, /* thêm entity mới ở đây */];
  ```
  `app.module.ts` (`entities: ENTITIES`) và `database/data-source.ts` (`entities: ENTITIES`) đều dùng barrel này — thêm entity chỉ sửa 1 chỗ.
- Riêng `TypeOrmModule.forFeature([...])` vẫn khai **từng entity cụ thể**, vì nó có nghĩa khác: "module này được inject Repository nào", không phải "connection load entity nào".
- Chiều phụ thuộc cho phép: `database/seeds/*` → `entities/*` (hạ tầng phụ thuộc domain). KHÔNG được ngược lại — entity không import gì từ `database/`.

## Seed dữ liệu (BẮT BUỘC theo pattern này)
- Seed **KHÔNG** nằm trong `<feature>.service.ts` (service chỉ chứa business logic) và **KHÔNG** viết thành migration (migration chỉ dành cho schema, chạy cả trên prod).
- Mỗi service có `src/database/seeds/` gồm: `seeder.interface.ts` (interface `Seeder { name; run(dataSource) }`), `<feature>.seeder.ts`, `index.ts` (`SEEDERS` + `runSeeders()`), `seed.module.ts` (chạy khi boot nếu `SEED_ON_BOOT=true`), `run-seed.ts` (entry cho `npm run seed`).
- Seeder là class thuần TypeScript, chỉ nhận `DataSource` — không phụ thuộc Nest, để dùng được cho cả 2 đường chạy.
- Seeder **phải idempotent theo từng bản ghi** (so key nghiệp vụ như `name`/`email`), không phải kiểu "chỉ seed khi bảng rỗng", và không ghi đè dữ liệu đang có.
- `SEED_ON_BOOT` chỉ set ở `docker-compose.yml` (dev). `docker-compose.prod.yml` KHÔNG set.
- Có unit test cho tính idempotent của seeder.

## Proto
- `proto/auth.proto`, `proto/product.proto`, `proto/order.proto` đã định nghĩa sẵn contract.
- Dùng đúng package name & message đã khai báo. Nếu cần đổi, sửa proto rồi cập nhật cả 2 phía.

## Khi được yêu cầu tạo service
1. Scaffold NestJS app trong `services/<name>`.
2. Cấu hình transport đúng (gRPC url từ env `GRPC_URL`, RMQ url từ env `RABBITMQ_URL`).
3. Kết nối DB qua `DATABASE_URL`.
4. Viết handler khớp proto.
5. Thêm unit test.
6. Đảm bảo `npm run build` pass.

## Điều KHÔNG làm
- Không thêm RDS/ElastiCache/Amazon MQ/Fargate (giữ chi phí ~$0, mọi thứ chạy container).
- Không hardcode secret; luôn đọc từ env.
- Không để service này import code/DB của service khác.
