# RabbitMQ — Kiến trúc & nguyên lý hoạt động

> Đọc file này từ trên xuống. Giả định bạn đã quen **AWS SQS/SNS** nhưng chưa biết RabbitMQ.
> Toàn bộ ví dụ dùng chính message flow `order.created` đang chạy thật trong dự án này
> (`order-service` publish → RabbitMQ → `notification-worker` consume, xem lại `note/day 4.md` mục 3.3/6.2–6.4).

---

## 1. Khác biệt gốc rễ: managed service vs broker bạn tự chạy

Cái đầu tiên cần khắc vào đầu, vì nó giải thích vì sao RabbitMQ "lằng nhằng" hơn SQS/SNS:

| | AWS SQS/SNS | RabbitMQ |
|---|---|---|
| Ai vận hành | AWS quản lý hạ tầng, bạn chỉ gọi API | Bạn tự chạy **1 process broker** (ở đây là container `rabbitmq` trong `docker-compose.yml`) |
| Cách publisher gửi | SNS: publish vào 1 **topic** (theo ARN) | Publish vào 1 **exchange** (theo tên, khai báo bằng code) |
| Cách consumer nhận | SQS: **poll** 1 queue (`ReceiveMessage`), API tự quản lý visibility timeout | **Subscribe** 1 queue, broker **tự đẩy** (push) message tới khi có consumer đang connect |
| Độ bền khi bật lại | Luôn bền (AWS managed) | Phải tự khai `durable: true` (exchange/queue) + `persistent: true` (message), nếu không mất khi broker restart |
| Định tuyến | SNS: fanout tới mọi subscriber, hoặc lọc bằng *filter policy* (JSON match) | 4 kiểu exchange định tuyến khác nhau (mục 2), linh hoạt hơn nhưng phải tự chọn đúng kiểu |

Vì bạn tự chạy broker, mọi thứ "vô hình" ở AWS (định tuyến, độ bền, DLQ) ở RabbitMQ đều phải **khai báo tường minh bằng code** — đó là toàn bộ nội dung `rabbitmq.publisher.ts` / `consumer.service.ts` trong dự án.

---

## 2. 3 khái niệm cốt lõi: Exchange – Binding – Queue

Đây là điểm khác lớn nhất so với SQS: ở SQS bạn gửi thẳng vào 1 queue. Ở RabbitMQ, **publisher không bao giờ gửi thẳng vào queue** — luôn gửi vào 1 **exchange** trước, exchange mới quyết định chuyển tiếp vào queue nào.

Ẩn dụ bưu điện:
- **Exchange** = bưu cục nhận thư. Publisher bỏ thư vào đây, kèm 1 **routing key** (giống địa chỉ ghi ngoài phong bì).
- **Binding** = "luật chuyển thư" mà mỗi hộp thư (queue) đăng ký với bưu cục: *"gửi cho tôi mọi thư có địa chỉ khớp mẫu X"*.
- **Queue** = hộp thư thật, nơi consumer tới lấy thư ra đọc.

```
   producer ──publish(routing_key)──►  [ EXCHANGE ]
                                            │  so routing_key với từng binding
                                            ▼
                              [ QUEUE A ]         [ QUEUE B ]
                              (binding key #1)    (binding key #2)
                                   │                    │
                              consumer A           consumer B
```

### 4 kiểu Exchange — khác nhau ở cách so khớp routing key

| Kiểu | So khớp | Gần giống SQS/SNS nào |
|---|---|---|
| **`direct`** | routing key phải **trùng tuyệt đối** với binding key | SNS filter policy kiểu so bằng chuỗi |
| **`topic`** | so theo **mẫu** với `*` (đúng 1 từ) và `#` (0 hoặc nhiều từ), phân cách bằng `.` — vd binding `order.*` khớp `order.created`, `order.paid` | Không có tương đương trực tiếp ở SNS (SNS filter policy match theo *message attribute*, không theo pattern trên 1 chuỗi khoá) |
| **`fanout`** | **bỏ qua routing key**, gửi cho **mọi** queue đã bind | Giống hệt **SNS fanout** (1 topic → nhiều subscriber) |
| **`headers`** | so theo header message thay vì routing key (ít dùng) | Gần giống SNS filter policy theo message attribute |

Dự án dùng **`topic`** cho exchange `orders` — lý do ghi rõ trong code (`rabbitmq.publisher.ts`):

```ts
await this.channel.assertExchange(ORDER_EXCHANGE, 'topic', { durable: true });
```

Chọn `topic` dù hiện chỉ có 1 routing key (`order.created`) vì đây là kiểu **mở rộng được**: sau này thêm `order.cancelled`, `order.paid`, worker khác chỉ cần bind thêm queue với key tương ứng (hoặc mẫu `order.#` để nhận tất) — **`order-service` không cần sửa 1 dòng nào**. Đây chính là *loose coupling* nhắc tới ở Day 4.

---

## 3. Vòng đời 1 message: publish → route → queue → ack/nack

```
[order-service]                    [RabbitMQ broker]                    [notification-worker]

channel.publish(              →    EXCHANGE 'orders' (topic)
  'orders',                             │ so 'order.created' với binding
  'order.created',                      ▼
  payload,                        QUEUE 'notifications.order-created'
  { persistent: true }                  │ (message nằm chờ ở đây, có thể
)                                       │  lâu tuỳ ý nếu chưa ai consume)
                                        ▼
                                  đẩy (push) tới consumer đang subscribe  →   channel.consume(queue, handler)
                                                                               │
                                                                          xử lý (gửi mail)
                                                                               │
                                        ◄──────────── channel.ack(msg) ───────┘  (thành công)
                                  message bị XOÁ khỏi queue
```

**Khác biệt quan trọng nhất so với SQS mà bạn cần nắm:**

| | SQS | RabbitMQ |
|---|---|---|
| Cơ chế "đang xử lý, đừng giao lại" | **Visibility timeout** — message ẩn đi N giây kể từ lúc `ReceiveMessage`, hết giờ tự hiện lại dù consumer còn sống hay đã chết | **Ack thủ công** — message ở trạng thái "unacked", gắn với **kết nối** của consumer đó. Không có đồng hồ đếm giờ; nếu consumer **crash / mất kết nối** trước khi ack, broker phát hiện connection đóng và **redeliver ngay lập tức** cho consumer khác |
| Xoá message | Gọi `DeleteMessage` sau khi xử lý xong | `channel.ack(msg)` |
| Báo lỗi / thử lại | Không gọi `Delete` → tự hết visibility timeout → giao lại | `channel.nack(msg, requeue: true/false)` — **chủ động** báo ngay, không cần chờ timeout |

Trong `consumer.service.ts` của dự án:
```ts
try {
  await this.email.sendOrderConfirmation(event);
  channel.ack(msg);              // thành công → xoá khỏi queue
} catch (error) {
  // thất bại → xem mục 4 (retry / DLQ)
}
```

> Điểm hay của mô hình "push + ack theo connection": không cần đoán trước "worker này xử lý xong trong bao lâu" như phải ước lượng visibility timeout ở SQS. Điểm phải tự lo: nếu quên gọi `ack`/`nack`, message treo "unacked" mãi, chiếm chỗ cho tới khi connection đóng.

---

## 4. Dead Letter Exchange (DLX) + retry đếm bằng header

SQS có sẵn **Redrive Policy** (`maxReceiveCount` + DLQ ARN) — khai 1 dòng config là xong, SQS tự đếm số lần nhận. RabbitMQ **không tự đếm** gì cả — đây là chỗ tốn code nhất trong `consumer.service.ts`, và là điểm dễ hiểu nhầm nhất khi mới học.

### DLX thực chất chỉ là... một Exchange bình thường

Không có khái niệm "hàng đợi lỗi" đặc biệt ở tầng broker. DLX chỉ là 1 exchange thường, được **gán vào queue chính** qua thuộc tính `deadLetterExchange` lúc khai queue:

```ts
await channel.assertQueue(NOTIFICATION_QUEUE, {
  durable: true,
  deadLetterExchange: DEAD_LETTER_EXCHANGE,   // 'orders.dlx'
});
```

Quy tắc: khi 1 message trong `NOTIFICATION_QUEUE` bị `nack(msg, requeue=false)` (hoặc hết TTL, hoặc queue đầy — dự án chỉ dùng case `nack`), RabbitMQ **tự động** publish lại message đó vào `orders.dlx`, dùng **cùng routing key** ban đầu. Vì `notifications.order-created.dlq` đã bind vào `orders.dlx` với đúng key `order.created`, nó "hứng" được message chết:

```
NOTIFICATION_QUEUE ──nack(requeue=false)──► DLX 'orders.dlx' ──(routing key cũ)──► DLQ 'notifications.order-created.dlq'
```

### Đếm retry: phải tự làm bằng message header

`amqplib` không có "lần nhận thứ mấy" như SQS `ApproximateReceiveCount`. Cách dự án giải quyết (`consumer.service.ts` + `retry.util.ts`):

```
xử lý lỗi:
  retries = đọc header 'x-retry-count' của message (mặc định 0)
  nếu retries < 3:
     → publish LẠI message (cùng nội dung) vào exchange chính,
       header 'x-retry-count' = retries + 1
     → ack bản GỐC (để nó biến mất khỏi queue, tránh xử lý trùng)
  nếu retries >= 3:
     → nack(requeue=false) → rơi qua DLX → vào DLQ, dừng hẳn
```

Vì sao không dùng `nack(msg, requeue=true)` đơn giản cho việc thử lại? Vì `requeue=true` đẩy message **về lại đầu queue ngay lập tức**, không có độ trễ, không đếm số lần → nếu lỗi permanent (vd bug code) thì consumer **lặp vô hạn, busy-loop cháy CPU**. Publish lại kèm counter là cách "giả lập" `maxReceiveCount` của SQS bằng tay.

---

## 5. `durable` và `persistent` — vì sao khai 2 chỗ khác nhau

SQS/SNS luôn bền vững, bạn không phải nghĩ tới việc "nếu AWS khởi động lại thì sao". RabbitMQ thì có, vì bạn tự chạy broker (ở đây là container, có thể bị `docker compose restart`):

- **`durable: true`** (khai trên **exchange**/**queue**) — chỉ đảm bảo **định nghĩa** (tên exchange, tên queue, binding) được ghi xuống đĩa, sống sót qua khi broker restart. Không liên quan tới nội dung message.
- **`persistent: true`** (khai trên **message**, lúc publish) — đảm bảo **bản thân message** được ghi xuống đĩa, không chỉ nằm trong RAM. Thiếu cờ này, message "mồ côi" nếu broker chết đột ngột giữa lúc còn nằm trong queue.

Dự án bật cả 2 (`rabbitmq.publisher.ts`):
```ts
await this.channel.assertExchange(ORDER_EXCHANGE, 'topic', { durable: true });
...
this.channel.publish(ORDER_EXCHANGE, ORDER_CREATED_ROUTING_KEY, payload, {
  persistent: true,
  contentType: 'application/json',
});
```
Thiếu 1 trong 2 thì vẫn chạy bình thường lúc demo — chỉ lộ ra khi broker restart giữa chừng lúc có message đang chờ xử lý.

---

## 6. Bảng tra nhanh: SQS/SNS ↔ RabbitMQ

| AWS | RabbitMQ | Ghi chú |
|---|---|---|
| SNS Topic | Exchange | RabbitMQ có 4 kiểu định tuyến, SNS chỉ có fanout + filter policy |
| SNS Topic Subscription | Binding (queue ↔ exchange, kèm routing/binding key) | |
| SQS Queue | Queue | Khái niệm giống nhau nhiều nhất |
| SQS `ReceiveMessage` (poll) | `channel.consume()` (broker **push** cho consumer) | Khác cơ chế: kéo vs đẩy |
| SQS Visibility Timeout | Ack thủ công theo connection | RabbitMQ không dùng đồng hồ đếm giờ |
| SQS `DeleteMessage` | `channel.ack(msg)` | |
| SQS return-to-queue (hết timeout) | `channel.nack(msg, requeue=true)` | RabbitMQ chủ động, không cần chờ |
| SQS Redrive Policy + `maxReceiveCount` | Tự code: đếm bằng header + `nack(requeue=false)` + DLX | RabbitMQ không tự đếm |
| SQS Dead Letter Queue | Queue bind vào 1 Dead Letter **Exchange** | DLX chỉ là exchange thường |
| SQS FIFO Queue (ordering) | 1 queue + đúng 1 consumer | Nhiều consumer cùng queue phá thứ tự (competing consumers) |
| Message Attributes | Message headers (`msg.properties.headers`) | |

---

## 7. Thực hành để cảm nhận (dùng luôn RabbitMQ đang chạy trong dự án)

1. **Xem trực quan qua UI quản trị**: mở `http://localhost:15672` (đăng nhập `guest`/`guest`, cấu hình ở `docker-compose.yml`).
   - Tab **Exchanges**: thấy `orders` (type `topic`) và `orders.dlx`.
   - Tab **Queues**: thấy `notifications.order-created` (cột *Consumers* = 1 vì `notification-worker` đang lắng nghe) và `notifications.order-created.dlq`.
   - Bấm vào queue `notifications.order-created` → tab **Bindings** để thấy nó bind vào exchange `orders` với key `order.created`.

2. **Nhìn message chạy real-time**: mở tab Queues, bấm vào `notifications.order-created`, để tab trình duyệt mở sẵn. Chạy `POST /orders` (như bạn vừa test ở phần trước) — do worker xử lý rất nhanh (mock email), bạn có thể tăng cơ hội "bắt được" message đang nằm trong queue bằng cách tạm dừng worker trước:
   ```bash
   docker compose stop notification-worker
   # tạo đơn qua curl/Swagger — message giờ NẰM Ở QUEUE (persistent, không mất)
   docker compose start notification-worker
   # theo dõi log: worker sẽ nhận và xử lý ngay khi kết nối lại
   ```
   Đây là bằng chứng "bắn rồi quên" thật sự: order-service trả 201 cho client dù worker đang tắt.

3. **Ép message vào DLQ** để thấy retry+DLX chạy đúng như mục 4 (bài đã có sẵn ở `note/day 4.md` mục 9.4): tạm sửa `email.service.ts` cho `throw new Error('test')` ở nhánh mock, rebuild worker, gọi `POST /orders`, xem log requeue lần 1→2→3 rồi "đẩy sang DLQ". Vào UI thấy 1 message nằm trong `notifications.order-created.dlq`. Nhớ hoàn tác code sau khi thử.

4. **So sánh trực tiếp với SQS**: nếu có tài khoản AWS, tạo thử 1 SNS topic + SQS subscriber với filter policy — so với việc khai `topic` exchange + binding key ở đây, để thấy 2 mô hình "giống nhau ở ý tưởng, khác nhau ở chỗ ai cầm dây".

5. **Dùng CLI thay UI** (khi quen tay hơn, nhanh hơn mở trình duyệt):
   ```bash
   docker compose exec rabbitmq rabbitmqctl list_exchanges name type
   docker compose exec rabbitmq rabbitmqctl list_queues name messages consumers
   docker compose exec rabbitmq rabbitmqctl list_bindings
   ```
