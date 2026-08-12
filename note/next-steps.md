# Việc cần làm — trước khi gen Day 5

> Ghi lại từ phiên review ngày 12-13/08. Đọc file này trước khi làm gì tiếp.

## 1. Đã xong (branch `day-4`, chưa merge `main`)

- Review code Day 4 (order-service + notification-worker) — 2 lỗi rẻ tiền đã vá:
  - Thêm timeout cho gRPC client `checkStock` (`PRODUCT_GRPC_TIMEOUT_MS`, default 3000ms) → hết hạn trả `DEADLINE_EXCEEDED` → gateway map sang HTTP 504.
  - Validate `email` rỗng trong `order.service.ts`.
- Dual-write (save order rồi publish event riêng, không outbox) — **để dành phase 2**, không vá vội.

## 2. Việc phải làm NGAY (trước khi merge `main` / gen Day 5)

- [x] Chạy prompt "vá trừ kho" đã đưa Claude Code — **lỗi nghiệp vụ thật, không phải phase 2**:
      hiện tại không có rpc nào trừ tồn kho, 2 đơn đặt cùng lúc sản phẩm còn 1 cái đều thành công.
      Thêm `DecrementStock` (atomic UPDATE có điều kiện `stock >= qty`) + `ReleaseStock`
      (rollback khi đơn nhiều item mà 1 item giữa chừng hết hàng).
- [x] `npm test` + `npx tsc --noEmit` ở `order-service` và `product-service` sau khi vá.
- [x] Merge `day-4` vào `main`.

## 3. Thực hành tay — làm hết trước khi gen Day 5 (không chỉ đọc note)

Từ `note/day 1.md` → `day 4.md`, mục cuối mỗi file ("Gợi ý thực hành"):

- **Day 1**: stop auth-service xem gateway lỗi; sửa `validateToken` xem hot-reload; xem log 2 process song song.
- **Day 2**: xem log request nhảy process; stop Redis xem `/refresh` lỗi (login vẫn sống); đợi token hết hạn (15 phút) rồi refresh; `psql` xem bảng `users`/`migrations`; thử `migration:generate`.
- **Day 3**: xem log 3 process (gateway→auth→product); `psql` xác nhận `product_db` tách biệt `auth_db`; restart product-service xem seed idempotent (chạy lại `npm run seed` sau khi xoá 1 sản phẩm); test 401/400 phân biệt lỗi guard vs validation; đọc `product.service.spec.ts`.
- **Day 4**: xem log order→worker qua RabbitMQ; đặt hàng sản phẩm hết hàng → 409, không tạo đơn; xem RabbitMQ UI (exchange/queue/DLQ); ép lỗi email tạm thời xem retry 1→2→3→DLQ; `psql` xem cột `items` JSONB.

**Thêm 2 bài KHÔNG có trong note (phát hiện lúc review, cần bổ sung):**

- [ ] **Test reconnect**: `docker compose stop product-service`, gọi `/products` (lỗi) → `docker compose start product-service`, đợi vài giây, gọi lại → xem gateway tự phục hồi hay phải restart. Trả lời được câu phỏng vấn "tắt bật lại service thì client tự nối lại không?".
- [ ] **Test timeout vừa vá**: tạm sửa `product.service.ts` thêm `await new Promise(r => setTimeout(r, 5000))` trước khi trả `checkStock`, rebuild, `POST /orders` → phải lỗi sau ~3s (không phải 5s) và trả 504. Xong nhớ xoá dòng sleep.
- [ ] **Test race condition trừ kho** (sau khi vá mục 2): 2 terminal bắn `POST /orders` cùng lúc cho sản phẩm còn 1 cái → chỉ 1 đơn thành công, đơn kia 409, tồn kho không âm.

## 4. Sau khi thực hành xong mới tới

- **Day 5 (deploy EC2) + Day 6 (CI/CD)**: hạ tầng thuần, AI gen được, chỉ cần hiểu ở mức cao (vì sao EC2 không ECS, security group mở gì, pipeline qua bước nào).
- **Day 7 (payment mock)**: KHÔNG gen chung batch với Day 5-6. Đây là logic nghiệp vụ, gần chắc sẽ lặp lại pattern dual-write của order — tự đọc kỹ, làm chậm, có thể gộp luôn vào phase 2 outbox thay vì làm riêng.
- **Phase 2** (sau 7 ngày, ~4-6 tuần, ~10h/tuần): transactional outbox, idempotency key, OpenTelemetry trace, SLO + k6 load test, failure injection (giết RabbitMQ/Postgres/worker giữa lúc chạy tải). Viết `DESIGN.md` tự tay TRƯỚC khi code phần này.

## 5. Việc treo song song (không chặn code, nhưng đừng quên)

- [ ] Repo `microservice` trên GitHub vẫn **public**, README vẫn còn mục "Điểm nhấn để đưa vào CV sau khi hoàn thành" — chưa gỡ. Cần: unpin, chuyển private, xóa mục đó. Giữ lại thư mục `note/`.
- [ ] Tiếp tục apply job song song, không đợi xong repo mới nộp.
