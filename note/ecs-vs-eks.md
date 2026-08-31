# ECS vs EKS — ghi chú phỏng vấn (rút từ chính deploy này)

> Cùng một hệ 5 microservice (api-gateway + auth/product/order + notification-worker,
> stateful đẩy ra RDS/ElastiCache/Amazon MQ) được deploy **hai lần**: bậc 1 ECS Fargate, bậc 2 EKS.
> Tài liệu này so sánh theo trải nghiệm thật, không phải feature-list.

---

## 0. Câu chốt (nói được câu này là đủ)

> **ECS và EKS không khác nhau ở "chạy được container hay không" — cả hai đều chạy tốt.
> Chúng khác ở AI SỞ HỮU control plane và BẠN PHẢI VẬN HÀNH BAO NHIÊU.**
> ECS = API riêng của AWS, ít bộ phận, AWS lo; đổi lại khóa nhà cung cấp.
> EKS = Kubernetes API tiêu chuẩn, hệ sinh thái mở, chạy mọi nơi; đổi lại bạn nuôi cả một platform.

Mọi khác biệt bên dưới đều chảy ra từ một điều: **ECS là proprietary AWS API, EKS là Kubernetes API.**

---

## 1. Bảng ánh xạ khái niệm (ECS ↔ EKS) — dùng đúng trong dự án này

| Vai trò | ECS (bậc 1) | EKS (bậc 2) | File thật trong repo |
|---|---|---|---|
| Đơn vị chạy | **Task** (1+ container) | **Pod** | — |
| Khai báo "chạy cái gì, mấy bản" | **Task Definition** + **Service** (desiredCount) | **Deployment** (replicas) | `infra/eks/manifests/10..20-*.yaml` |
| Expose nội bộ | Service + **Cloud Map** DNS | **Service (ClusterIP)** + **CoreDNS** | `*.ecommerce.svc.cluster.local` trong `01-configmap.yaml` |
| Vào từ internet | **ALB + Target Group** (tự tạo tay) | **Ingress** + **AWS Load Balancer Controller** (tự sinh ALB) | `21-ingress.yaml` |
| Cấu hình không bí mật | `environment` trong task def | **ConfigMap** | `01-configmap.yaml` |
| Bí mật | Secrets Manager → `secrets` (ARN) trong task def | **Secret** (k8s) | `create-secrets.sh` → `app-secret` |
| Danh tính AWS cho code | **Task Role** | **IRSA** (IAM Roles for Service Accounts) | `cluster.yaml` (serviceAccounts) |
| Kéo image + đọc secret lúc boot | **Execution Role** | Node IAM role + IRSA | `eksNodeRole` |
| Tự co giãn | Service Auto Scaling (target tracking) | **HPA** + **metrics-server** | `30-hpa.yaml` |
| Chạy 1 lần (migration) | **run-task** | **Job** | `40-migration-job.yaml` |
| Stateful | **KHÔNG để trong ECS** → RDS/ElastiCache/Amazon MQ | **KHÔNG để trong EKS** → như trên (bonus: StatefulSet+PVC để thấy vì sao đau) | `90-postgres-statefulset.yaml` |

**Điểm nói:** danh sách này chính là câu trả lời cho "so sánh ECS và EKS" — ánh xạ *từng* khái niệm, không nói chung chung.

---

## 2. Bốn trục khác biệt đáng đào sâu

### a) Service discovery: Cloud Map (DNS do AWS quản) vs CoreDNS (DNS trong cluster)
- ECS: đăng ký service vào **Cloud Map** → `auth-service.microservice.local`. AWS quản lý bản ghi.
- EKS: mỗi Service có bản ghi trong **CoreDNS** → `auth-service.ecommerce.svc.cluster.local`. Chạy *bên trong* cluster.
- Cùng giải một bài (gRPC gọi nhau bằng tên), nhưng EKS làm bằng chính hạ tầng k8s → không phụ thuộc AWS API.

### b) Vào từ ngoài: imperative (ECS) vs declarative (EKS)
- ECS: bạn **bấm tay tạo ALB + target group** rồi trỏ vào service. ALB là tài nguyên bạn sở hữu trực tiếp.
- EKS: bạn khai một **Ingress**, và **AWS Load Balancer Controller** (một pod chạy trong cluster) **tự sinh ALB**. Bạn không bấm Create ALB nào.
- Đây là ví dụ **imperative vs declarative** đắt giá: cùng ra một ALB, nhưng ở EKS nó là *hệ quả* của việc khai báo trạng thái mong muốn.
- ⚠️ Hệ quả vận hành: **xoá Ingress TRƯỚC khi xoá cluster**, nếu không ALB thành mồ côi (controller chết → không ai dọn).

### c) Danh tính: Task Role vs IRSA — cùng ý tưởng, cùng cạm bẫy tên gọi
- Cả hai đều nhằm: **pod/task tự có quyền AWS mà không cần access key**.
- ECS tách rõ **execution role** (ECS kéo image + đọc secret lúc khởi động) vs **task role** (code trong container gọi SDK). Gán nhầm → task không start *hoặc* SDK `AccessDenied`.
- EKS làm bằng **IRSA**: gắn IAM role vào một ServiceAccount qua OIDC. "IRSA = task role của thế giới k8s."

### d) Scaling: target-tracking (ECS) vs HPA+metrics-server (EKS)
- ECS Service Auto Scaling đọc metric từ **CloudWatch** (AWS lo thu thập).
- EKS HPA cần **metrics-server** — một component *bạn* phải có trong cluster — mới biết CPU/memory. Không có nó, HPA mù (`TARGETS <unknown>`).
- Lại đúng chủ đề: EKS đẩy trách nhiệm thu thập metric về phía bạn.

---

## 3. Cái giá thật của EKS = 3 lỗi lớp hạ tầng gặp khi deploy (war stories)

Đây là phần mạnh nhất khi phỏng vấn: **không phải lý thuyết mà là lỗi thật đã tự tay sửa.**
Toàn bộ lớp lỗi này **không tồn tại ở ECS** — vì ở ECS những thứ này là AWS API, không phải component bạn nuôi.

1. **AWS Load Balancer Controller CrashLoopBackOff → Ingress `no endpoints available`.**
   Controller đi hỏi VPC ID qua **IMDS**, nhưng pod không với tới IMDS (IMDSv2 `hop-limit=1`) → crash.
   Fix: truyền thẳng `--set region --set vpcId` cho Helm để khỏi gọi IMDS.
   *Bài học:* lỗi webhook `no endpoints` = pod sau webhook chưa Ready, KHÔNG phải manifest sai.

2. **metrics-server: `kubectl apply` bản upstream đè lên EKS add-on → `kubectl top` chết.**
   Add-on đã có sẵn; apply bản upstream thêm `k8s-app` vào Service selector → Service khớp 0 pod → Metrics API `MissingEndpoints`.
   Fix: `aws eks update-addon --resolve-conflicts OVERWRITE` (hoặc patch selector).
   *Bài học:* kiểm tra add-on đã tồn tại trước khi cài tay; đừng apply đè tài nguyên do component khác quản.

3. **`notification-worker` `FailedCreate: serviceaccount not found`.**
   Manifest trỏ một IRSA ServiceAccount chỉ được tạo ở đường `eksctl` (`cluster.yaml`), còn đường Console không tạo → hai runbook phân kỳ.
   Fix (email đang mock): dùng SA `default`.
   *Bài học:* **unenforced manual step across divergent runbooks** — thêm verify gate (`kubectl get deploy` đủ 5 READY).

> Và một **bug tầng code** lộ ra chỉ khi chạy trên config deploy thật:
> `POST /orders` → `TypeError: No timeout provided`. Env từ ConfigMap là **string** `"3000"`, code truyền
> thẳng vào `rxjs.timeout()` (chỉ nhận number) → vỡ. **"Chạy local, chết khi deploy."**
> Fix: `Number(config.get(...)) || 3000`. *Bài học:* mọi env đọc ra đều là string — ép kiểu ở biên.

**Tổng kết cái giá:** ECS giấu 3 lớp lỗi trên vì AWS vận hành hộ. EKS phơi chúng ra — đó vừa là "đau" vừa là **quyền kiểm soát và khả năng mở rộng vô hạn** (cài được ArgoCD/Istio/KEDA/cert-manager... bằng `kubectl apply`).

---

## 4. Chọn cái nào?

| Chọn **ECS** khi | Chọn **EKS** khi |
|---|---|
| Team nhỏ, all-in AWS | Cần hệ sinh thái k8s (service mesh, GitOps, operator, CRD) |
| Chỉ cần chạy container ổn định | Đa cloud / tránh khóa nhà cung cấp |
| Không muốn nuôi platform | Tổ chức đã chuẩn hoá trên Kubernetes |
| **Control plane miễn phí** | Chấp nhận **$0.10/h control plane** + tự vận hành |

**Phản biện thành thật cho dự án này:** với 5 service, **ECS là lựa chọn đúng hơn cho workload thật** — EKS là overkill, đắt và phức tạp không cần thiết. Giá trị của việc làm EKS ở đây là **học được ranh giới AWS ↔ Kubernetes**, không phải vì nó tốt hơn.

---

## 5. Soundbites (học thuộc vài câu)

- *"ECS/EKS phân biệt bằng ai sở hữu control plane và bạn vận hành bao nhiêu, không phải bằng feature."*
- *"Stateful không để trong orchestrator vì nó reschedule container bất cứ lúc nào → đẩy ra RDS/ElastiCache/Amazon MQ. Container stateless bị giết thì vô hại, Postgres bị giết thì mất data."*
- *"Cloud Map với ECS, CoreDNS với EKS — cùng giải service discovery cho gRPC."*
- *"ALB ở ECS tôi tạo tay (imperative); ở EKS tôi khai Ingress và controller tự sinh ALB (declarative) — nhớ xoá Ingress trước khi xoá cluster kẻo ALB mồ côi."*
- *"IRSA là task role của thế giới k8s; execution role vs task role ở ECS là hai vai trò tách bạch dễ gán nhầm."*
- *"Lỗi webhook `no endpoints available` nghĩa là pod sau webhook chưa Ready, không phải YAML sai."*
- *"Env đọc từ ConfigMap luôn là string — tôi từng dính `rxjs.timeout('3000')` vỡ vì quên ép kiểu."*
