# deploy-guild.md — Lộ trình deploy, đọc gì trước đọc gì sau

> **File này là bản đồ, không phải hướng dẫn.** Nó chỉ nói: *hôm nay mở file nào, làm mục nào,
> xong thì kiểm tra ra sao*. Nội dung chi tiết nằm ở các file được trỏ tới — đừng chép lại vào đây.
>
> Dành cho người **lần đầu deploy**. Cứ đi tuần tự từ trên xuống, không nhảy cóc.
> Kế hoạch gốc: [`next-plan.md`](./next-plan.md).

---

## 0. Quy ước đánh số ngày (đọc kỹ, dễ nhầm)

Repo có **hai cách đánh số ngày** vì kế hoạch đã pivot giữa chừng:

| | Lịch cũ (`README.md` ở gốc repo) | Lịch mới (`next-plan.md` + mọi file trong `infra/`, `cicd/`) |
|---|---|---|
| Ngày 1–4 | Viết code 5 service | — (đã xong rồi) |
| Ngày 5 trở đi | *"Deploy lên EC2"* — **đã huỷ** | **Ngày AWS 1 → 15** |

**Từ đây trở đi file này chỉ dùng "Ngày AWS N".** Ngày AWS 1 = ngày đầu tiên bạn chạm vào AWS,
tức là "ngày 5" theo cách bạn đang đếm. Mọi tiêu đề trong `infra/` và `cicd/` đều dùng số này.

Có 15 ngày AWS, chia 3 nhóm ưu tiên:

| Nhóm | Ngày AWS | Nội dung | Ý nghĩa |
|---|---|---|---|
| 🔴 **Phải đáp đất** | 1–4 | ECS Fargate chạy được + CI/CD | Xong nhóm này là đã có câu chuyện deploy hoàn chỉnh để đi phỏng vấn, **kể cả khi account chết ngay sau đó** |
| 🟡 **Stretch giá trị cao** | 5–11 | Dựng lại chính hệ đó trên EKS | Phần giá trị nhất cho CV, nhưng chỉ làm khi 🔴 đã xong |
| 🟢 **Nếu kịp** | 12–15 | Hardening, so sánh ECS↔EKS, teardown | Đệm chống trượt lịch — người mới **luôn** trượt, đừng nhồi việc bắt buộc vào đây |

---

## 1. Trước khi bắt đầu — làm 1 lần

**Bước 1. Đọc 2 file này trước tiên, đọc hết, đừng lướt** (~30 phút):

1. [`next-plan.md`](./next-plan.md) — *vì sao* đi ECS trước rồi mới EKS, vì sao stateful ra managed service.
2. [`../infra/common/COST_PLAN.md`](../infra/common/COST_PLAN.md) — $190 tiêu vào đâu, cái gì ăn tiền
   khi bạn đang ngủ. **Đây là file quan trọng nhất repo đối với người mới.**

**Bước 2. Chọn đường đi.** Đọc mục *"Hai đường đi: Console để HỌC, CLI để LẶP LẠI"* trong
[`../infra/README.md`](../infra/README.md).

> **Khuyến nghị cho bạn (lần đầu deploy): đi đường Console** cho toàn bộ Ngày AWS 1–2,
> rồi mở file script CLI tương ứng **đọc comment** để hiểu mình vừa bấm cái gì.
> Console dạy bạn *có những ô nào tồn tại*; script dạy bạn *vì sao mỗi ô có giá trị đó*.
> Từ Ngày AWS 5 (EKS) thì bắt buộc dùng `kubectl` — lý do ở đầu `infra/eks/CONSOLE_GUIDE.md`.

**Bước 3. Chuẩn bị máy.** Cần: tài khoản AWS, Docker chạy được, `git`.
AWS CLI thì Ngày AWS 1 mới thật sự cần (để push image lên ECR — Console không làm được việc đó).

---

## 1b. Ba folder làm gì — và vì sao `deploy/` ít xuất hiện

| Folder | Trả lời câu hỏi | Tần suất dùng |
|---|---|---|
| `infra/` | *"Dựng hạ tầng thế nào?"* | **1 lần** mỗi tài nguyên. Đây là nơi bạn ở lâu nhất khi học |
| `deploy/` | *"Đưa code lên hạ tầng đó thế nào?"* | **mỗi lần đổi code** |
| `cicd/` | *"Làm sao để `deploy/` tự chạy khi push?"* | 1 lần setup, sau đó tự động |

`deploy/` xuất hiện ít trong hướng dẫn **không phải vì không cần**, mà vì hai lý do:

1. Phần lớn thời gian nó **chạy bên trong CI**, không phải bạn gõ. Từ Ngày AWS 3, GitHub Actions
   gọi `deploy/ecs/deploy-ecs.sh`; từ Ngày AWS 10 gọi `deploy/eks/deploy-eks.sh`.
   Bạn không thấy nó, nhưng xoá đi là pipeline gãy.
2. Nó là **thao tác lặp**, không phải bài học. Bấm Console 30 bước để hiểu ECS là hợp lý;
   bấm 30 bước mỗi lần sửa một dòng code thì không.

**Những lúc bạn thật sự gõ tay `deploy/`:**

| Ngày AWS | Lệnh | Bắt buộc? |
|---|---|---|
| 1 | `./deploy/push-ecr.sh` | ✅ **có** — Console không upload image lên ECR được |
| 5–6 | `./deploy/eks/create-secrets.sh` · `./deploy/eks/apply-manifests.sh` | ✅ **có** — Console không tạo Secret/Deployment của k8s được |
| 2 | `./deploy/ecs/register-taskdefs.sh` | ❌ không — bản CLI thay cho Bước 4 bấm tay |

Và một file đọc-để-tra, không phải chạy: [`deploy/env-template.txt`](../deploy/env-template.txt) —
liệt kê mọi biến môi trường của 5 service, kèm cột *"biến này khai ở đâu"* (task definition của ECS
hay ConfigMap/Secret của k8s). Mở nó ở Ngày AWS 1 (lúc tạo secret), Ngày AWS 2 (task def) và
Ngày AWS 5–6 (ConfigMap).

Tổng quan folder: [`deploy/README.md`](../deploy/README.md).

---

## 2. Bảng tổng — cả 15 ngày trên một trang

| Ngày AWS | Việc | File cần mở | Có gõ `deploy/` không |
|---|---|---|---|
| **1** 🔴 | Hạ tầng dùng chung: budget, SG, ECR, RDS, Valkey, MQ, Secrets | `infra/common/CONSOLE_GUIDE.md` | ✅ `push-ecr.sh` |
| **2** 🔴 | ECS Fargate: IAM, Cloud Map, cluster, task def, ALB, service, migration | `infra/ecs-fargate/CONSOLE_GUIDE.md` | — (tuỳ chọn `register-taskdefs.sh`) |
| **3** 🔴 | CI/CD cho ECS (GitHub Actions) | `cicd/CONSOLE_GUIDE.md` Route A | 🤖 CI gọi `ecs/deploy-ecs.sh` |
| **4** 🔴 | Đệm + hardening ECS, đọc lại log | `infra/ecs-fargate/README.md` | — |
| **5–6** 🟡 | EKS: cluster, node group, 5 Deployment | `infra/eks/CONSOLE_GUIDE.md` bước 0–5 | ✅ `eks/create-secrets.sh`, `eks/apply-manifests.sh` |
| **7** 🟡 | EKS: Ingress (ALB Controller) | `infra/eks/CONSOLE_GUIDE.md` bước 6 | — |
| **8** 🟡 | EKS: nối stateful + probe | `infra/eks/README.md` §Ngày 8 | — |
| **9** 🟡 | EKS: HPA + rolling update / rollback | `infra/eks/CONSOLE_GUIDE.md` bước 7 | — |
| **10** 🟡 | CI/CD mở rộng sang EKS | `cicd/README.md` + `cicd/CONSOLE_GUIDE.md` A4 | 🤖 CI gọi `eks/deploy-eks.sh` |
| **11** 🟢 | Bonus: Postgres bằng StatefulSet + PVC | `infra/eks/manifests/90-postgres-statefulset.yaml` | — |
| **12–13** 🟢 | Hardening + viết bản so sánh ECS↔EKS | `infra/eks/README.md` §Bản đồ ECS → EKS | — |
| **14–15** 🟢 | Đệm / **teardown an toàn** / ghi chú CV | `infra/common/COST_PLAN.md` §4 | — |

✅ = bạn gõ tay · 🤖 = CI gọi hộ (bạn không gõ, nhưng xoá file là pipeline gãy)

---

## 3. Từng ngày

### 🔴 Ngày AWS 1 — Hạ tầng dùng chung (~3h)

Dựng **một lần**, dùng cho cả ECS lẫn EKS. Sang bậc 2 không phải dựng lại gì ở đây.

| | |
|---|---|
| **Đọc trước** | [`infra/common/README.md`](../infra/common/README.md) — hiểu vì sao stateful không nằm trong orchestrator (5 phút) |
| **Làm theo** | [`infra/common/CONSOLE_GUIDE.md`](../infra/common/CONSOLE_GUIDE.md) — Bước 0 → Bước 6, **đúng thứ tự** |
| **Gõ tay** | Bước 2 (push image) **bắt buộc dùng terminal**: `AWS_REGION=us-east-1 ./deploy/push-ecr.sh` — Console không upload image lên ECR được. Đây là lần đầu bạn dùng `deploy/` |
| **Chạy song song** | Bấm tạo RDS/Valkey/MQ (Bước 3–5) rồi **để đó**, mở terminal chạy `push-ecr.sh` trong lúc chờ. 3 dịch vụ mất 5–15 phút. |
| **Xong khi** | Tick hết mục *"✅ Checklist cuối Ngày 1"* ở cuối file |
| **Trước khi tắt máy** | Mục *"💸 Trước khi tắt máy"* ở cuối file |

> ⚠️ Bước 1 (security group) có một cái bẫy: `sg-app` cần 3 rule gRPC **trỏ về chính nó**, mà lúc
> tạo lần đầu chưa có id nên chưa chọn được. Phải tạo xong rồi **quay lại Edit inbound rules**.
> File đã ghi rõ, nhưng đây là chỗ bị sót nhiều nhất — quên là Ngày AWS 2 gateway trả 504.

**Muốn hiểu sâu hơn sau khi làm xong** (đọc lúc chờ resource provision):
`infra/common/01-networking.md`, `02-ecr.md`, `03-stateful.md`, `04-secrets.md` — mỗi file 5 phút,
giải thích *vì sao* của đúng những ô bạn vừa điền.

---

### 🔴 Ngày AWS 2 — ECS Fargate chạy end-to-end (~4h, ngày nặng nhất)

Đây là ngày bạn thấy hệ thống sống trên internet. Đừng bỏ dở giữa chừng.

| | |
|---|---|
| **Đọc trước** | [`infra/ecs-fargate/README.md`](../infra/ecs-fargate/README.md) — chỉ đọc mục **Kiến trúc** (sơ đồ) để hình dung mình đang dựng cái gì |
| **Chuẩn bị** | Lấy ra giấy nhớ Ngày AWS 1: 3 sg-id, endpoint Valkey, 6 ký tự đuôi ARN secret, Account ID |
| **Làm theo** | [`infra/ecs-fargate/CONSOLE_GUIDE.md`](../infra/ecs-fargate/CONSOLE_GUIDE.md) — Bước 1 → Bước 8 |
| **Xong khi** | `curl http://<ALB-DNS>/products` ra danh sách sản phẩm (Bước 8) |
| **Trước khi tắt máy** | Mục *"💸 Trước khi tắt máy"* — hạ 5 service về `desired = 0` |

**Nếu task chết (gần như chắc chắn sẽ gặp ít nhất 1 lần):**
mở mục *"Đọc lỗi trong Console khi task chết"* trong chính file đó. Bảng `Stopped reason` → nguyên nhân
xử được ~90% trường hợp. **Đọc `Stopped reason` TRƯỚC khi mò CloudWatch** — lỗi Ngày AWS 2 hầu hết
là lỗi hạ tầng, log app trống trơn.

> Bước 4 (task definition) làm 5 lần, khá nản. Dùng đường **Create new task definition with JSON**
> và copy từ `infra/ecs-fargate/taskdef/*.json` — nhanh hơn form nhiều.

---

### 🔴 Ngày AWS 3 — CI/CD cho ECS (~3h)

Làm **ngay** khi ECS vừa chạy, đừng để dành: setup còn nóng trong đầu, và từ đây mọi thay đổi tự deploy.

| | |
|---|---|
| **Đọc trước** | [`cicd/README.md`](../cicd/README.md) — mục **Cấu trúc** + **Nguyên tắc** (10 phút) |
| **Làm theo** | [`cicd/CONSOLE_GUIDE.md`](../cicd/CONSOLE_GUIDE.md) — **chỉ Route A** (GitHub Actions), bước A1 → A3 |
| **Bỏ qua** | Route B (CodePipeline) và bước A4 — để dành, A4 là của Ngày AWS 10 |
| **Xong khi** | Push 1 commit lên `main` → tab Actions xanh → ECS chạy revision mới |
| **Chạy ngầm** | Workflow gọi `deploy/ecs/deploy-ecs.sh` để deploy. Bạn không gõ lệnh này, nhưng nên **mở đọc 20 dòng đầu** — nó giải thích vì sao deploy theo git SHA chứ không theo tag `latest` |

> Bẫy lớn nhất ở đây là **`iam:PassRole`**. Thiếu nó, workflow fail với `AccessDeniedException`
> mà **không hề nhắc chữ PassRole** ở dòng đầu. File đã ghi rõ ở bước A2 — đọc kỹ khối JSON đó.

**Làm Route B (CodePipeline) khi nào?** Chỉ khi bạn đã xong nhóm 🟡 và còn dư thời gian ở Ngày 12–13.
Nó không dạy thêm gì về deploy, chỉ thêm một dòng vào CV.

---

### 🔴 Ngày AWS 4 — Đệm + hardening ECS (~2–3h)

**Ngày này không có việc mới. Đó là chủ ý.** Người mới luôn trượt lịch ở Ngày 1–3; đây là chỗ để bù.

Nếu bạn không trượt, dùng ngày này để:

1. Đọc mục *"Failure mode hay gặp"* trong [`infra/ecs-fargate/README.md`](../infra/ecs-fargate/README.md)
   — **đây là phần "thịt" để trả lời phỏng vấn**. Với mỗi dòng, tự hỏi: *"nếu gặp cái này, tôi sẽ tìm ở đâu?"*
2. Mở CloudWatch → Log groups → `/ecs/<mỗi service>` — đọc log thật của app mình trên cloud.
3. Cố tình phá một thứ rồi sửa lại: xoá 1 rule gRPC trong `sg-app`, gọi `/products`, xem lỗi 504,
   rồi thêm lại. **Gây lỗi có chủ đích là cách học nhanh nhất** — và bạn sẽ kể được câu chuyện này khi phỏng vấn.

**Chốt chặn:** hết Ngày AWS 4 mà chưa `curl` được qua ALB thì **đừng sang EKS**. Ở lại xử cho xong.
Một hệ ECS chạy được + CI/CD là đủ để đi phỏng vấn; một cluster EKS dựng dở thì không.

---

### 🟡 Ngày AWS 5–6 — EKS: cluster + 5 service (~4h/ngày)

| | |
|---|---|
| **Đọc trước** | [`infra/eks/README.md`](../infra/eks/README.md) — mục **Bản đồ ECS → EKS**. Đọc kỹ bảng này, nó là toàn bộ giá trị của bậc 2 |
| **Đọc tiếp** | Mục **⚠️ Chọn phiên bản Kubernetes** cùng file — chọn sai version là **$14.40/ngày thay vì $2.40** |
| **Làm theo** | [`infra/eks/CONSOLE_GUIDE.md`](../infra/eks/CONSOLE_GUIDE.md) — Bước 0 → Bước 5 |
| **Gõ tay** | Bước 5 dùng `./deploy/eks/create-secrets.sh` (Secrets Manager → k8s Secret) và `./deploy/eks/apply-manifests.sh` (thay placeholder rồi apply). Console **không** tạo được Secret/Deployment của k8s |
| **Xong khi** | `kubectl get pods -n ecommerce` thấy 5 pod `Running`, Job migration `Completed` |
| **Trước khi tắt máy** | Mục *"💸 Trước khi tắt máy"* — scale node group về 0 |

**Chia việc 2 ngày:** Ngày 5 = Bước 0 → 4 (cluster + node + tag subnet + SG). Ngày 6 = Bước 5 (kubectl).
Tạo cluster mất ~15 phút chờ — dùng lúc đó đọc mục **Bản đồ ECS → EKS**.

> Từ Bước 5 trở đi Console **không** tạo được Deployment/Service. Đây không phải thiếu sót của hướng
> dẫn mà là bản chất của Kubernetes — lý do ở đầu file, và **nói được ranh giới AWS ↔ Kubernetes này
> là một điểm cộng phỏng vấn thật sự**.

**Hai bẫy chắc chắn gặp** (đều đã ghi trong file, nhưng nhắc trước cho khỏi mất buổi):
- Quên **tag subnet** `kubernetes.io/role/elb=1` → Ngày AWS 7 Ingress treo mãi không báo lỗi.
- Quên mở **`sg-data` cho cluster security group** → pod nối RDS bị *timeout* (không phải "refused",
  nên rất dễ tưởng sai endpoint và đi mò nhầm chỗ).

---

### 🟡 Ngày AWS 7 — Ingress (~3h)

| | |
|---|---|
| **Làm theo** | [`infra/eks/CONSOLE_GUIDE.md`](../infra/eks/CONSOLE_GUIDE.md) — **Bước 6** |
| **Xong khi** | `curl http://<ingress-address>/health` → 200 |

Sau khi xong, mở **EC2 → Load Balancers** trong Console: bạn sẽ thấy một ALB **tự xuất hiện mà bạn
không hề bấm Create**. Đối chiếu với Ngày AWS 2 (bạn tự tạo ALB bằng tay) — đó là khác biệt
**imperative vs declarative**, một trong những thứ dễ ghi điểm nhất khi phỏng vấn.

> ⚠️ Từ hôm nay, **luôn `kubectl delete ingress` trước khi xoá cluster**. Quên là ALB thành mồ côi,
> vẫn tính $0.55/ngày và không có gì tự dọn.

---

### 🟡 Ngày AWS 8 — Nối stateful + probe (~3h)

| | |
|---|---|
| **Làm theo** | [`infra/eks/README.md`](../infra/eks/README.md) — mục **Ngày 8** |
| **Trọng tâm** | Bảng `readinessProbe` vs `livenessProbe`. Phân biệt được hai cái này là câu hỏi phỏng vấn kinh điển |
| **Xong khi** | `POST /orders` qua Ingress → CloudWatch/`kubectl logs` thấy notification-worker nhận event |

Điểm nối với bậc 1: RDS/Valkey/MQ **y hệt Ngày AWS 1**, chỉ đổi chỗ khai báo (ConfigMap/Secret thay
vì task definition). Nếu phải provision lại gì ở bước này thì bạn đang làm sai.

---

### 🟡 Ngày AWS 9 — HPA + rollback (~3h)

| | |
|---|---|
| **Làm theo** | [`infra/eks/CONSOLE_GUIDE.md`](../infra/eks/CONSOLE_GUIDE.md) — **Bước 7**, rồi [`infra/eks/README.md`](../infra/eks/README.md) mục **Ngày 9** |
| **Xong khi** | `kubectl get hpa -n ecommerce` cột `TARGETS` ra **số** (không phải `<unknown>`), và `kubectl rollout undo` chạy được |

Thử `kubectl rollout undo deployment/api-gateway` một lần cho biết cảm giác. ECS **không có** lệnh
tương đương gọn như vậy — đây là một dòng cụ thể để so sánh ở Ngày 12–13.

---

### 🟡 Ngày AWS 10 — CI/CD sang EKS (~2h, nhẹ)

| | |
|---|---|
| **Đọc** | [`cicd/README.md`](../cicd/README.md) — mục **⚠️ Quyền EKS không nằm ở IAM** |
| **Làm theo** | [`cicd/CONSOLE_GUIDE.md`](../cicd/CONSOLE_GUIDE.md) — **bước A4** (đã bỏ qua ở Ngày AWS 3), rồi bật job `deploy-eks` trong `ci.yml` |
| **Xong khi** | Push 1 commit → pod chạy image có tag = SHA của commit đó |
| **Chạy ngầm** | Workflow gọi `deploy/eks/deploy-eks.sh` (`kubectl set image` + `rollout status`) — thay cho `deploy/ecs/deploy-ecs.sh` của bậc 1. **Đây chính là toàn bộ delta giữa 2 bậc** |

Ngày này nhẹ vì phần đắt (test + build + push) đã dùng chung từ Ngày AWS 3 — **chỉ đổi bước cuối**.
Chính điều đó là câu chuyện: *pipeline đa target, phần đắt tái sử dụng*.

---

### 🟢 Ngày AWS 11 — Bonus: StatefulSet (~2h)

| | |
|---|---|
| **Làm theo** | [`infra/eks/manifests/90-postgres-statefulset.yaml`](../infra/eks/manifests/90-postgres-statefulset.yaml) — đọc phần comment ở đầu file, làm đủ **5 thí nghiệm** |
| **Xong khi** | Bạn tự tay thấy: xoá pod → data còn; xoá PVC → data mất vĩnh viễn |

Đây là bài **cố tình làm cái mà production không làm**, để hiểu vì sao. Kiểu hiểu
*"tôi biết làm, và biết vì sao production không làm thế"* rất được đánh giá cao.
Đừng cho app thật dùng nó.

---

### 🟢 Ngày AWS 12–13 — Hardening + viết bản so sánh

Nếu đã trượt lịch thì dùng 2 ngày này để bắt kịp. Nếu không:

1. **Viết bản so sánh ECS ↔ EKS bằng lời của bạn.** Mở bảng **Bản đồ ECS → EKS** trong
   [`infra/eks/README.md`](../infra/eks/README.md), che cột phải đi và tự nói lại từng dòng.
   Chỗ nào nói không trôi là chỗ bạn chưa thật sự hiểu — quay lại làm lại đúng bước đó.
2. Đọc mục **Điểm nói khi phỏng vấn** trong [`next-plan.md`](./next-plan.md) §7, tự trả lời từng gạch đầu dòng.
3. Hardening (tuỳ chọn): private subnet + NAT / VPC endpoint — xem
   [`infra/common/01-networking.md`](../infra/common/01-networking.md) mục *Quyết định đơn giản hoá*.
   Biết *đường chuẩn là gì và vì sao mình cố ý không đi* đã đủ để trả lời phỏng vấn — không nhất thiết phải làm thật.
4. Route B (CodePipeline) nếu muốn thêm dòng CV: [`cicd/CONSOLE_GUIDE.md`](../cicd/CONSOLE_GUIDE.md) Route B.

---

### 🟢 Ngày AWS 14–15 — Teardown + chốt

| | |
|---|---|
| **Làm theo** | [`infra/common/COST_PLAN.md`](../infra/common/COST_PLAN.md) — §4, khối *"Xoá hẳn khi kết thúc dự án"*, **đúng thứ tự** |
| **Trước khi xoá** | Chụp màn hình: kiến trúc ECS, `kubectl get all -n ecommerce`, Actions xanh, Ingress trả 200. **Xoá rồi là không chụp lại được** |
| **Xong khi** | `aws ce get-cost-and-usage` (§5) cho thấy chi phí ngày hôm sau về gần 0 |

> ⚠️ Thứ tự teardown quan trọng: **Ingress trước, cluster sau**. Ngược lại là ALB mồ côi.

---

## 4. Nghi thức mỗi ngày

**Đầu buổi (2 phút):** mở Billing → Cost Explorer xem chi tiêu hôm qua. Bất thường thì dừng lại tìm
nguyên nhân trước khi làm tiếp — xem [`infra/common/COST_PLAN.md`](../infra/common/COST_PLAN.md) §5,
bảng nghi phạm theo thứ tự.

**Cuối buổi (5 phút):** mục *"💸 Trước khi tắt máy"* ở cuối file bạn đang làm hôm đó —
có trong `infra/common/CONSOLE_GUIDE.md`, `infra/ecs-fargate/CONSOLE_GUIDE.md`,
`infra/eks/CONSOLE_GUIDE.md`, và `infra/eks/README.md` (ở đó tên là *"💸 Trước khi nghỉ mỗi ngày"*).
**Đừng bỏ** — RDS + Valkey + MQ + EKS control plane chạy 24/7 kể cả khi bạn đang ngủ.

---

## 5. Khi bí — tra ở đâu

| Triệu chứng | Mở file | Mục |
|---|---|---|
| Task ECS chết / `PENDING` mãi | `infra/ecs-fargate/CONSOLE_GUIDE.md` | *Đọc lỗi trong Console khi task chết* |
| Gọi API qua ALB lỗi 502/504 | `infra/ecs-fargate/README.md` | *Failure mode hay gặp* |
| Pod `ImagePullBackOff` / `CrashLoopBackOff` / `Pending` | `infra/eks/README.md` | *Debug — 5 lệnh dùng 90% thời gian* |
| Ingress không ra `ADDRESS` | `infra/eks/README.md` | *Chuẩn bị subnet* + bảng debug |
| GitHub Actions đỏ | `cicd/CONSOLE_GUIDE.md` | *Lỗi hay gặp* |
| Không nối được RDS / Valkey / MQ | `infra/common/03-stateful.md` | phần ⚠️ của từng dịch vụ |
| Không biết biến môi trường nào đặt ở đâu | `deploy/env-template.txt` | *BIẾN NÀY KHAI Ở ĐÂU?* |
| Không rõ script `deploy/` nào dùng lúc nào | `deploy/README.md` | *Luồng chuẩn* |
| Hoá đơn tăng bất thường | `infra/common/COST_PLAN.md` | §5 |

**Nguyên tắc khi bí:** đọc thông báo lỗi **đầy đủ** trước (`Stopped reason` với ECS,
`kubectl describe` phần Events với EKS), rồi mới tra bảng. Đừng đoán rồi sửa mò — trên cloud,
sửa mò tốn tiền thật.

---

## 6. Điều dễ làm sai nhất (đọc lại trước mỗi ngày mới)

1. **Sai region.** Mọi thứ ở `us-east-1`. Tài nguyên khác region **không nhìn thấy nhau** và bạn sẽ
   mất hàng giờ không hiểu vì sao. Kiểm góc trên phải Console mỗi lần vào.
2. **Nhảy sang EKS khi ECS chưa chạy.** Nhóm 🔴 là điều kiện tiên quyết, không phải gợi ý.
3. **Quên tắt cuối ngày.** Đây là cách phổ biến nhất để đốt hết $190 mà chưa làm xong.
4. **Bấm Console mà không đọc vì sao.** Sau mỗi ngày, mở file script CLI tương ứng đọc comment.
   Phỏng vấn không hỏi "bạn bấm nút nào", họ hỏi "vì sao chọn thế".
5. **Không ghi lại.** Mỗi lần gặp lỗi và sửa được, ghi 2 dòng vào `note/` — triệu chứng + nguyên nhân.
   Cuối 15 ngày bạn có sẵn một danh sách câu chuyện thật để kể, giá trị hơn mọi thứ khác trong repo này.
