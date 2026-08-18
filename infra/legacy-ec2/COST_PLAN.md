# Cost Plan — 17 ngày, credit $158.38, ngân sách tiêu $130

> Lập ngày 16/08/2026. Region tham chiếu: **ap-southeast-1 (Singapore)**.
> Giá lấy từ bảng on-demand Linux tại thời điểm lập (kiểm chứng lại ở AWS Pricing Calculator trước khi bấm Launch).
> Phạm vi: phần còn lại của Phase 1 (Day 5-7) + toàn bộ Phase 2.

---

## 1. Kết luận ngắn (đọc cái này là đủ để hành động)

| Câu hỏi | Trả lời |
|---|---|
| Máy **tối thiểu chạy được** cả stack | `t3.small` (2 GB) — chạy được nhưng chỉ còn ~0.5 GB headroom, không đủ cho Phase 2 |
| Máy **nên dùng** | **`t3.medium` (4 GB, x86_64)**, 30 GB gp3, ap-southeast-1 |
| `t3.micro` (1 GB) | **Không đủ** — đúng như bạn thấy. Xem tính toán RAM ở mục 2 |
| Tổng chi 17 ngày (t3.medium chạy 24/7 + phụ phí) | **≈ $25.5** |
| Kịch bản Phase 2 "chơi thoáng" (nâng RAM, ALB, load-gen, log) | **≈ $50** |
| Ngân sách $130 | **Không cần tiêu hết.** Dự phóng thực tế $45–55, dư $75–85 làm đệm |
| Credit còn thiếu | 4 nhiệm vụ onboarding × $20 = **$80**, chi phí để lấy < **$0.50**. Xem mục 6 |

Điểm quan trọng của một tech lead: **$130 là trần, không phải chỉ tiêu**. Credit dư không mất đi trong 17 ngày —
nó là bảo hiểm cho việc Phase 2 chạy k6 load test làm hoá đơn nhảy bất ngờ, hoặc bạn quên stop instance.

---

## 2. Vì sao t3.micro không đủ — tính RAM theo từng container

Stack Phase 1 = 3 hạ tầng + 5 Node process, tất cả trên **cùng 1 EC2** (không RDS/MQ managed, theo `CLAUDE.md`).

| Thành phần | RSS thực tế điển hình (prod, image alpine) |
|---|---|
| Amazon Linux 2023 + Docker daemon + containerd | 250 – 350 MB |
| `postgres:16-alpine` (3 DB, shared_buffers mặc định 128 MB) | 150 – 250 MB |
| `rabbitmq:3.13-alpine` (Erlang VM, bản không-management) | 120 – 200 MB |
| `redis:7-alpine` (maxmemory 64 MB) | 15 – 40 MB |
| 5 × NestJS `node:24-alpine` chạy `node dist/main.js` | 5 × 70–110 MB = **350 – 550 MB** |
| **Tổng** | **≈ 0.95 – 1.4 GB** (chưa tính page cache cho Postgres) |

- **1 GB (t3.micro)**: tổng đã vượt RAM vật lý → mọi thứ rơi xuống swap 2 GB, `docker compose pull` lúc deploy tạo spike → OOM-kill. Đây là lý do bạn thấy nó không đủ.
- **2 GB (t3.small)**: chạy được ổn định ở trạng thái idle/demo. Nhưng lúc deploy (pull image mới + container cũ chưa kịp chết) và lúc Phase 2 thêm OTel Collector + Jaeger (~300–500 MB) là hết chỗ.
- **4 GB (t3.medium)**: còn ~2.5 GB headroom → đủ cho Phase 2 (outbox worker, OTel, Jaeger/Tempo, k6 chạy nhẹ) mà không phải đụng lại hạ tầng giữa chừng. **Chọn cái này.**

> Tự kiểm chứng số ở trên: khi stack local đang chạy, gõ `docker stats --no-stream`. Cột `MEM USAGE`
> cộng lại chính là con số bảng trên. (Máy WSL hiện tại chưa bật Docker Desktop WSL integration nên chưa đo được.)

### Vì sao không chọn t4g (Graviton/ARM) dù rẻ hơn ~20%

`t4g.medium` = $0.0424/h so với `t3.medium` = $0.0528/h → tiết kiệm **$4.24 cho cả 17 ngày**.
Đổi lại phải build `linux/arm64` (buildx hoặc runner ARM trong GitHub Actions ở Day 6) cho cả 5 image.
**Không đáng** — $4 không mua nổi một buổi debug CI. Giữ x86_64.

---

## 3. Cấu hình đề xuất (copy vào lúc tạo instance)

```
AMI               Amazon Linux 2023 (x86_64)
Instance type     t3.medium   (2 vCPU burstable, 4 GB)
Credit spec       standard    ← QUAN TRỌNG, xem cảnh báo bên dưới
Storage           30 GB gp3 (3000 IOPS / 125 MB/s đã bao gồm, không mua thêm)
IAM profile       role có AmazonEC2ContainerRegistryReadOnly
User data         infra/legacy-ec2/ec2-userdata.sh (giữ nguyên, swap 2 GB vẫn hữu ích làm đệm)
Security group    22 ← chỉ IP của bạn ; 80 ← 0.0.0.0/0 ; KHÔNG mở 5432/6379/5672/15672
Region            ap-southeast-1 (Singapore)
Tag               Name=ecommerce-prod
```

> ⚠️ **T3 mặc định bật chế độ `unlimited`**: khi hết CPU credit, AWS **tự tính thêm** $0.05/vCPU-hour thay vì bóp CPU.
> Ở Phase 2 bạn sẽ chạy k6 load test — đó chính là lúc credit CPU cháy. Đặt `standard` lúc launch
> (hoặc `aws ec2 modify-instance-credit-specification --cpu-credits standard`) để không bao giờ có dòng lạ trong bill.
> Nếu muốn load test chạy đúng tốc độ, bật `unlimited` **có chủ đích** trong lúc test rồi tắt lại — vài cent, nhưng là quyết định của bạn chứ không phải tai nạn.

### `mem_limit` nên chỉnh lại trong `docker-compose.prod.yml`

File hiện tại được đặt cho 1 GB (tổng limit ~1.05 GB) — chạy trên 4 GB sẽ **bóp cổ Postgres một cách vô ích**.
Giá trị đề xuất cho t3.medium (tổng 2.85 GB, chừa ~1.15 GB cho OS + docker + page cache):

| Service | Hiện tại | Đề xuất (t3.medium) |
|---|---|---|
| postgres | 256m | **768m** |
| rabbitmq | 192m | **512m** |
| redis | 96m | **128m** |
| api-gateway | 128m | **320m** |
| auth / product / order-service | 128m mỗi cái | **288m** mỗi cái |
| notification-worker | 96m | **256m** |

---

## 4. Bảng chi phí — 17 ngày (408 giờ), chạy 24/7

### 4.1 Đường cơ sở (Phase 1 còn lại + Phase 2, 1 instance duy nhất)

| Hạng mục | Cách tính | Thành tiền |
|---|---|---:|
| EC2 t3.medium | 408 h × $0.0528 | **$21.54** |
| EBS 30 GB gp3 | 30 GB × $0.096/GB-tháng × (408/730) | **$1.61** |
| Public IPv4 (1 địa chỉ) | 408 h × $0.005 | **$2.04** |
| ECR private storage (~2 GB sau lifecycle policy) | 2 GB × $0.10 × (408/730) | **$0.11** |
| Data transfer out | < 10 GB, trong hạn 100 GB/tháng miễn phí | **$0.00** |
| CloudWatch metrics/logs mặc định, SES vài email | ước tính | **≈ $0.20** |
| **TỔNG** | | **≈ $25.5** |

Nếu dùng `t3.small` thay `t3.medium`: EC2 còn $10.77 → tổng **≈ $14.7**. Tiết kiệm $10.8 — không đáng để đánh đổi headroom Phase 2.

### 4.2 Chia theo giai đoạn

| Giai đoạn | Ngày | Hạng mục | Chi phí |
|---|---|---|---:|
| **Phase 1 còn lại** (Day 5 deploy, Day 6 CI/CD, Day 7 payment mock) | 7 ngày = 168 h | t3.medium + EBS + IP + ECR | **≈ $10.5** |
| **Phase 2** (outbox, idempotency, OTel, SLO/k6, failure injection) | 10 ngày = 240 h | t3.medium + EBS + IP | **≈ $15.0** |
| | | **Cộng** | **≈ $25.5** |

### 4.3 Add-on Phase 2 (chọn cái nào thì cộng thêm cái đó)

| Add-on | Vì sao muốn | Chi phí 10 ngày |
|---|---|---:|
| Nâng lên `t3.large` (8 GB) suốt Phase 2 | Chạy OTel Collector + Jaeger + k6 cùng lúc mà không lo RAM | +$12.7 |
| 1 instance load-gen `c7i-flex.large` bật ~30 h | Bắn tải từ máy khác cho số liệu SLO sạch (không tự bắn vào chính mình) | +$3.1 |
| ALB + HTTPS (ACM cert miễn phí) | Học health check, target group, TLS termination | +$6.0 |
| CloudWatch Logs ~5 GB ingest | Giữ log tập trung khi làm failure injection | +$3.0 |
| CPU surplus lúc load test (nếu để `unlimited`) | | +$1–3 |
| **Tối đa nếu lấy hết** | | **+$26–28** |

**Tổng kịch bản "chơi thoáng": $25.5 + $28 ≈ $53.5.** Vẫn chỉ dùng **41%** của $130.

### 4.4 Phân bổ $130 (khung kiểm soát, không phải chỉ tiêu)

```
$26   Hạ tầng cơ sở 17 ngày (bắt buộc)          ████
$28   Add-on Phase 2 (tuỳ chọn, có chủ đích)     ████
$1    Lấy 4 nhiệm vụ credit (mục 6)              ▏
─────────────────────────────────────────────────
$55   Dự phóng thực tế
$75   ĐỆM: quên stop máy, load test quá tay, làm lại instance, phát sinh Phase 2
```

Ngưỡng cảnh báo AWS Budgets nên đặt: **$40 / $70 / $100** (alert email). Nếu chạm $70 mà chưa sang tuần Phase 2 thì
có gì đó đang chạy mà bạn không biết — nghi phạm số 1 là instance quên terminate và Elastic IP mồ côi.

---

## 5. Cách giữ chi phí đúng dự phóng

1. **Không cần stop instance mỗi đêm.** Với ngân sách này, chạy 24/7 chỉ tốn $1.27/ngày và bạn có URL sống để demo bất cứ lúc nào. Việc "stop khi không dùng" trong `AWS_SETUP.md` mục 7 là lời khuyên cho tài khoản $0 — không áp dụng ở đây.
2. **Build image ở GitHub Actions, không build trên EC2.** 4 GB RAM đủ *chạy* nhưng build 5 image song song sẽ đụng trần. Free tier Actions 2000 phút/tháng là đủ.
3. **ECR lifecycle policy giữ 3 image/repo** (đã ghi trong `AWS_SETUP.md` mục 2) — không có nó thì sau 17 ngày CI/CD, ECR phình lên vài chục GB.
4. **Elastic IP: chỉ giữ khi instance đang chạy.** IP không gắn vào đâu vẫn bị tính $0.005/h. Khi terminate instance nhớ release IP.
5. **Đừng bật Multi-AZ / Performance Insights / NAT Gateway.** NAT Gateway ($0.059/h + $0.059/GB) là cái bẫy đốt credit nhanh nhất của người mới — với kiến trúc 1 instance trong public subnet, bạn **không cần** nó.
6. **Xoá CodePipeline nếu Day 6 chốt đi đường GitHub Actions** ($1/pipeline/tháng, nhỏ nhưng vô ích).

---

## 6. Lấy nốt $80 credit còn thiếu (5 nhiệm vụ × $20)

Tài khoản tạo từ 15/07/2025 nhận **$100 khi đăng ký + tối đa $100 khi hoàn thành 5 nhiệm vụ onboarding, mỗi nhiệm vụ $20**.
Bạn đã xong **AWS Budgets ($20)**. Còn lại 4 nhiệm vụ:

| # | Nhiệm vụ | Thao tác tối thiểu | Chi phí thực | Ghi chú |
|---|---|---|---:|---|
| 1 | **Launch (và terminate) 1 EC2 instance** | Launch `t3.micro` rỗng, đợi `running`, terminate | ~$0.02 | Làm bằng **instance rác riêng**, đừng terminate máy prod. Có thể làm ngay trong lúc setup Day 5 |
| 2 | **Configure 1 RDS database** | Tạo `db.t4g.micro`, Single-AZ, 20 GB gp2, tắt backup & Performance Insights → đợi `Available` → Delete, **không** tạo final snapshot | ~$0.05 (bật ~1 h) | ⚠️ Đây là hành động **ngoài kiến trúc dự án** chỉ để lấy credit. `CLAUDE.md` cấm RDS trong app — giữ nguyên: app vẫn dùng Postgres container. Xoá RDS ngay sau khi credit ghi nhận |
| 3 | **Deploy 1 Lambda function** | Console → Lambda → Create function (runtime **Node.js 24**, author from scratch) → Test | **$0** | Always-free 1M request/tháng. `nodejs24.x` có từ 11/2025, khớp Node 24 của dự án. Handler phải là `async` — Lambda 24 bỏ kiểu callback |
| 4 | **Test 1 prompt trong Amazon Bedrock** | Bedrock → Model access → request Claude Haiku → Playground → gửi 1 prompt ngắn | < $0.01 | Nếu region đang dùng chưa mở model, làm ở `us-east-1` |
| 5 | ~~Set up AWS Budget~~ | ✅ đã xong | — | |

**Tổng chi để lấy $80: dưới $0.10.** ROI ~800×. Làm hết trong 1 buổi, đừng để lỡ hạn 6 tháng.

Kiểm tra tiến độ & số dư: **Billing and Cost Management → Free Tier** (có bảng tiến độ nhiệm vụ) và
**→ Credits** (số dư, ngày hết hạn). Credit thường ghi nhận sau vài phút đến 48 h — làm xong đừng kết luận vội.

### Hai điều phải biết về Free plan

- **Free plan không bao giờ charge thẻ của bạn.** Hết credit thì AWS **đóng tài khoản** (giữ dữ liệu 90 ngày để nâng cấp), chứ không xuất hoá đơn. Với $158 + $80 sắp có, tiêu $55 thì không có rủi ro này.
- Free plan **chặn** Marketplace, Reserved Instance, Savings Plans, mua phần cứng. Không ảnh hưởng gì tới kế hoạch trên.
- Nếu sau này upgrade lên Paid plan, credit còn lại vẫn dùng được tới 12 tháng kể từ ngày đăng ký — nhưng từ lúc đó **vượt credit là mất tiền thật**.

---

## 7. Bảng giá tham chiếu (ap-southeast-1, on-demand Linux)

| Instance | vCPU | RAM | $/giờ | $/17 ngày (408 h) |
|---|---|---|---:|---:|
| t3.micro | 2 | 1 GB | 0.0132 | 5.39 |
| t4g.small | 2 | 2 GB | 0.0212 | 8.65 |
| t3.small | 2 | 2 GB | 0.0264 | 10.77 |
| t4g.medium | 2 | 4 GB | 0.0424 | 17.30 |
| **t3.medium** | 2 | 4 GB | **0.0528** | **21.54** |
| t4g.large | 2 | 8 GB | 0.0848 | 34.60 |
| c7i-flex.large | 2 | 4 GB | 0.0978 | 39.90 |
| t3.large | 2 | 8 GB | 0.1056 | 43.08 |
| m7i-flex.large | 2 | 8 GB | 0.1197 | 48.84 |

Phụ phí: EBS gp3 **$0.096**/GB-tháng · EBS gp2 $0.12/GB-tháng · Public IPv4 **$0.005**/giờ ·
ECR $0.10/GB-tháng · Data out ~$0.09/GB (100 GB/tháng đầu miễn phí toàn account).

> So sánh region: `t3.medium` ở us-east-1 là $0.0416/h → rẻ hơn $4.57 cho 17 ngày, đổi lại latency từ VN ~200 ms
> thay vì ~35 ms. Demo cho recruiter Việt Nam thì Singapore đáng tiền hơn.
