# CLAUDE.md — Định hướng cho Claude Code CLI

> Đặt file này ở gốc repo. Claude Code CLI đọc tự động để hiểu bối cảnh dự án.

## Dự án
E-commerce microservices để học. Monorepo, mỗi service là 1 ứng dụng NestJS độc lập trong `services/`.

## Nguyên tắc kiến trúc (BẮT BUỘC tuân theo)
- **Database-per-service**: mỗi service chỉ truy cập database của chính nó. KHÔNG query chéo DB.
- **Sync = gRPC**: api-gateway ↔ các service, và order-service → product-service dùng gRPC. Proto ở `proto/`.
- **Async = RabbitMQ**: order-service **publish** event; notification-worker **consume**. Không gọi trực tiếp.
- **api-gateway** là nơi DUY NHẤT nhận REST từ client và xử lý JWT guard.
- Không service nào expose REST ra ngoài trừ api-gateway.

## Tech & convention
- NestJS + TypeScript, `@nestjs/microservices` (gRPC + RMQ transport).
- ORM: TypeORM (hoặc Prisma — chọn 1 và giữ nhất quán). Migration bật sẵn.
- Config qua `@nestjs/config`, đọc từ biến môi trường (xem docker-compose).
- Validation bằng `class-validator` ở DTO của api-gateway.
- Mỗi service có: `Dockerfile` (copy từ mẫu, đổi `SERVICE_DIR`), `package.json` với script `start:dev`, `build`, `test`, `lint`.
- Test bằng Jest. Mỗi service có ít nhất vài unit test cho business logic.

## Cấu trúc mỗi service
```
services/<name>/
├── src/
│   ├── main.ts          # bootstrap microservice (gRPC listen hoặc RMQ consumer)
│   ├── app.module.ts
│   ├── database/        # mọi thứ tầng DB gom về đây
│   │   ├── data-source.ts       # DataSource cho TypeORM CLI + npm run seed
│   │   ├── migrations/          # chỉ thay đổi SCHEMA
│   │   └── seeds/               # dữ liệu mẫu (xem mục Seed bên dưới)
│   └── <feature>/       # controller (gRPC handler) + service + entity + dto
├── test/
├── package.json
├── tsconfig.json
└── Dockerfile
```

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
