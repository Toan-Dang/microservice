# Console Guide — Bậc 2: EKS (Ngày 5–11)

> **Bản bấm chuột.** Bản CLI tương ứng: [`cluster.yaml`](./cluster.yaml) + `eksctl`,
> [`allow-nodes-to-data.sh`](./allow-nodes-to-data.sh).

> **Trạng thái đối chiếu (18/08/2026).**
> ✅ Tạo cluster (wizard 6 trang, `Support type`, `Bootstrap cluster administrator access`),
> tạo managed node group (4 trang) — **đã đối chiếu** với docs AWS và đã sửa lại.
> ⚠️ Tag subnet, access entry, add-on — dựa trên docs nhưng chưa đối chiếu từng nhãn màn hình.

## Đọc trước: EKS **không** làm hết bằng Console được

Đây không phải hạn chế của hướng dẫn này mà là bản chất của Kubernetes:

| Việc | Console làm được? |
|---|---|
| Tạo cluster, node group, add-on, IAM/access entry | ✅ đầy đủ |
| Xem Deployment/Pod/Service/Ingress, xem log, sửa replicas | ✅ tab **Resources** của cluster |
| **Tạo Deployment/Service/Ingress/Secret/Job** | ❌ **phải dùng `kubectl`** |

Lý do: EKS là *managed control plane*. AWS quản cluster; còn **mọi thứ bên trong cluster** nói
chuyện bằng Kubernetes API, không phải AWS API — Console AWS chỉ đọc/sửa hạn chế qua một lớp proxy.

**Nên làm:** Console cho phần AWS (bước 1–4 + 8), `kubectl` cho phần k8s (bước 5–7).
Và đây chính là bài học của bậc 2: ở ECS mọi thứ là AWS API nên Console làm được hết;
ở EKS ranh giới AWS ↔ Kubernetes hiện ra rất rõ. **Nói được ranh giới này là điểm cộng phỏng vấn.**

---

## Bước 0 — Cài 2 công cụ trên máy

```bash
# kubectl
curl -sLO "https://dl.k8s.io/release/$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -m 0755 kubectl /usr/local/bin/kubectl && kubectl version --client

# helm (cần cho AWS Load Balancer Controller ở bước 6)
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

`eksctl` **không bắt buộc** nếu bạn tạo cluster bằng Console — nhưng nó gộp ~10 bước bấm thành
1 lệnh. Bản CLI ở [`cluster.yaml`](./cluster.yaml).

---

## Bước 1 — IAM role cho cluster và cho node

Console **không** tự tạo 2 role này; trình tạo cluster sẽ bắt bạn chọn, nên làm trước.

### 1a. `eksClusterRole` (cho control plane)

**IAM → Roles → Create role**

| Trường | Chọn |
|---|---|
| Trusted entity | **AWS service** → service **EKS** → use case **EKS - Cluster** |
| Permissions | `AmazonEKSClusterPolicy` (tự gắn sẵn) |
| Role name | `eksClusterRole` |

### 1b. `eksNodeRole` (cho EC2 worker node)

| Trường | Chọn |
|---|---|
| Trusted entity | **AWS service** → **EC2** |
| Permissions (tick 3) | `AmazonEKSWorkerNodePolicy`, `AmazonEC2ContainerRegistryReadOnly`, `AmazonEKS_CNI_Policy` |
| Role name | `eksNodeRole` |

> Thiếu `AmazonEC2ContainerRegistryReadOnly` → pod `ImagePullBackOff` dù image có thật trên ECR.
> Thiếu `AmazonEKS_CNI_Policy` → node `NotReady` mãi vì vpc-cni không cấp được IP cho pod.

---

## Bước 2 — Tạo cluster

**Console → Elastic Kubernetes Service → Clusters → `Add cluster` → `Create`**

Wizard có 6 trang. Điền như sau:

**Trang đầu — Configuration options**

| Trường | Chọn | Vì sao |
|---|---|---|
| Configuration options | **Custom configuration** | *Quick configuration* sẽ dựng EKS Auto Mode |
| EKS Auto Mode | **tắt** `Use EKS Auto Mode` | Auto Mode tự quản node (AWS chọn instance, tự scale) — **đắt hơn** và giấu mất đúng thứ ta cần học |

**Trang `Configure cluster`**

| Trường | Chọn | Vì sao |
|---|---|---|
| Name | `ecommerce` | |
| Cluster IAM role | `eksClusterRole` | tạo ở bước 1 |
| Kubernetes version | **1.35** | phải còn standard support — xem cảnh báo dưới |
| **Support type** ⚠️ | **Standard support** | **đây là cái chốt tiền** — xem dưới |
| Secrets encryption | tắt | |
| ARC Zonal shift | tắt | |
| **Cluster access** → Bootstrap cluster administrator access | **để nguyên (bật)** | người tạo cluster **tự động** là Kubernetes admin |
| **Cluster access** → Cluster authentication mode | **EKS API and ConfigMap** | dùng được cả access entry (mới) lẫn `aws-auth` (cũ) |

**Trang `Specify networking`**

| Trường | Chọn | Vì sao |
|---|---|---|
| **VPC** | **VPC default** — **cùng VPC với RDS/Valkey/MQ** ⚠️ | khác VPC thì pod không nối được stateful, phải VPC peering |
| Subnets | **≥2 subnet public** (Console chọn sẵn tất cả — bỏ bớt nếu muốn) | |
| Security groups | để trống, Console tự tạo cluster security group | |
| Cluster IP address family | **IPv4** | |
| Cluster endpoint access | **Public** | để `kubectl` từ máy bạn vào được |
| Control plane egress | để mặc định **Amazon EKS managed** | |

**Trang `Configure observability`** — bật `API`, `Audit` nếu muốn (tính tiền theo GB log), không bắt buộc.

**Trang `Select add-ons`** — VPC CNI, CoreDNS, kube-proxy **đã được chọn sẵn**, giữ nguyên.
Thêm **Amazon EBS CSI Driver** ngay tại đây (cần cho bài bonus StatefulSet ở Ngày 11) — chọn lúc này
đỡ phải quay lại cài sau.

**Trang `Configure selected add-ons settings`** → để mặc định → **Next**.

**Trang `Review and create`** → **Create** → **~15 phút**. Trạng thái `Creating` → `Active`.

> 💡 **`Support type` là nút chống hoá đơn gấp 6.** Chọn **Standard support** thì cluster **không thể**
> tự trôi sang extended support khi version hết hạn — AWS sẽ buộc bạn nâng cấp thay vì âm thầm
> tính $0.60/h. Chọn *Extended support* là cho phép nó tự trôi. Người mới hầu như không để ý ô này.
> (Nếu bạn chọn một version **đang** ở extended support thì Console sẽ không cho chọn Standard.)

> ⚠️ **Chọn version là quyết định TIỀN.** Control plane tính **$0.10/h khi version còn standard
> support**, nhưng **$0.60/h khi rơi vào extended support** — $2.40/ngày so với **$14.40/ngày**.
> Mỗi minor version có standard support 14 tháng.
> Tính tới **08/2026**: standard = **1.34 / 1.35 / 1.36**; **1.33 đã hết ngày 29/07/2026**.
> Console có hiển thị nhãn *Standard support* / *Extended support* cạnh mỗi version trong dropdown —
> **nhìn nhãn đó trước khi chọn**, đừng chọn version cũ vì "quen thuộc hơn".
>
> ⚠️ Tiền bắt đầu chạy ngay từ lúc `Active`, kể cả cluster rỗng không pod nào.
> Đây là khoản đắt nhất của bậc 2 — đừng tạo cluster rồi bỏ đó vài ngày.

---

## Bước 3 — Node group

Cluster `Active` → mở cluster → tab **Compute** → **Add node group**. Wizard có 4 trang:

**Trang `Configure node group`**

| Trường | Chọn |
|---|---|
| Name | `ng-1` |
| Node IAM role | `eksNodeRole` ⚠️ **không** được dùng lại role của cluster |
| Use launch template | bỏ qua |
| Kubernetes labels / taints / tags | bỏ qua |

**Trang `Set compute and scaling configuration`**

| Trường | Chọn |
|---|---|
| AMI type | **Amazon Linux 2023 (x86_64)** |
| Capacity type | **On-Demand** |
| Instance types | **t3.medium** |
| Disk size | 20 GiB |
| **Desired size / Minimum size / Maximum size** | **2 / 0 / 3** |
| Node group update configuration | mặc định |
| Node auto repair | tuỳ chọn (EKS tự thay node hỏng) |
| Warm pool | tắt |

**Trang `Specify networking`**

| Trường | Chọn |
|---|---|
| Subnets | các subnet public đã tag ở bước 4c |
| Configure SSH access to nodes | **tắt** (bật thì phải có key pair, và không bật lại được sau khi tạo) |

**Trang `Review and create`** → **Create**.

> **Minimum = 0** là cố ý: cho phép scale node group về 0 khi hết giờ học mà không phải xoá.
> Đây là nút tiết kiệm tiền chính của bậc 2.
>
> **t3.medium (4 GB)** chứ không phải micro: mỗi node còn phải nuôi CoreDNS, kube-proxy, vpc-cni,
> ALB controller trước khi tới lượt 5 pod của bạn.
>
> ⚠️ **x86_64, không phải Graviton (`t4g`)** — image trên ECR build cho `linux/amd64`.
> Chọn nhầm t4g thì pod chết với `exec format error`.
>
> ⚠️ Tài liệu EKS nói thẳng: *"If you choose a public subnet, and your cluster has only the public
> API server endpoint enabled, then the subnet must have `MapPublicIPOnLaunch` set to `true` for the
> instances to successfully join a cluster."* — đúng cái bẫy ở bước 4c. Subnet của default VPC bật sẵn.

Chờ ~5 phút → status `Active`.

---

## Bước 4 — Add-on + quyền truy cập + security group

### 4a. Add-on (nếu chưa chọn lúc tạo cluster)

Cluster → tab **Add-ons** → **Get more add-ons**. `vpc-cni`, `coredns`, `kube-proxy` được Console
cài mặc định khi tạo cluster. Nếu bước 2 bạn chưa thêm **Amazon EBS CSI Driver** thì thêm ở đây
(cần cho bài bonus StatefulSet ở Ngày 11).

### 4b. Quyền xem Resources trong Console

**Bạn thường KHÔNG phải làm gì.** Ở trang `Configure cluster`, mục **Bootstrap cluster administrator
access** để bật (mặc định) nghĩa là **principal tạo cluster tự động là Kubernetes admin** — mở tab
**Resources** là xem được ngay.

Chỉ cần làm bước dưới khi bạn xem cluster bằng **user/role khác** với lúc tạo (ví dụ tạo bằng
`eksctl` với profile A, xem Console bằng SSO user B), hoặc khi bạn đã tắt bootstrap access:

Cluster → tab **Access** → **Create access entry**

| Trường | Chọn |
|---|---|
| IAM principal ARN | user/role đang đăng nhập Console |
| Type | Standard |
| Access policy | `AmazonEKSClusterAdminPolicy`, scope **Cluster** |

> Triệu chứng khi thiếu: tab **Resources** báo *"Your current IAM principal doesn't have access
> to Kubernetes objects on this cluster"*. Bài học vẫn giữ nguyên giá trị: quyền AWS (IAM) và quyền
> trong cluster (Kubernetes RBAC) là **hai lớp riêng biệt** — chỉ là EKS đã tự bắc cầu cho người tạo.

### 4c. Tag subnet (BẮT BUỘC — Console không tự làm)

**EC2 → Subnets** → chọn từng subnet đã dùng cho cluster → tab **Tags** → **Manage tags**:

| Key | Value |
|---|---|
| `kubernetes.io/role/elb` | `1` |
| `kubernetes.io/cluster/ecommerce` | `shared` |

Cũng ở trang subnet, kiểm tra cột **Auto-assign public IPv4 address** = `Yes`
(Actions → Edit subnet settings nếu chưa).

| Thiếu gì | Triệu chứng — và vì sao khó đoán |
|---|---|
| tag `kubernetes.io/role/elb=1` | Ingress ở bước 6 kẹt mãi `ADDRESS <none>`; không có thông báo lỗi nào ở Console |
| Auto-assign public IPv4 = No | node `NotReady` hoặc pod `ImagePullBackOff` — managed node group **không** tự gán public IP, mà ta cố ý không dùng NAT Gateway |

> Tạo cluster bằng `eksctl` cũng **không** tự tag subnet của VPC có sẵn. Đây là bước bị bỏ sót
> nhiều nhất khi dùng VPC dựng từ trước.

### 4d. Mở `sg-data` cho node

Cluster → tab **Networking** → copy **Cluster security group** (`sg-...`).

**EC2 → Security Groups → `ecommerce-sg-data` → Edit inbound rules** → thêm 3 rule,
Source = cluster security group vừa copy:

| Type | Port |
|---|---|
| PostgreSQL | 5432 |
| Custom TCP | 6379 |
| Custom TCP | 5671 |

> `sg-data` hiện chỉ mở cho `sg-app` (SG của Fargate ở bậc 1). Node EKS có SG **khác** → pod nối
> RDS sẽ **timeout** (không phải "refused", nên rất dễ tưởng là sai endpoint và đi mò nhầm chỗ).

---

## Bước 5 — Từ đây dùng `kubectl` (Console không tạo được)

```bash
aws eks update-kubeconfig --region us-east-1 --name ecommerce
kubectl get nodes                      # phải thấy 2 node Ready

kubectl apply -f infra/eks/manifests/00-namespace.yaml

# sửa REDIS_URL thành endpoint ElastiCache thật trước khi apply
kubectl apply -f infra/eks/manifests/01-configmap.yaml

./deploy/eks/create-secrets.sh         # đọc Secrets Manager → tạo k8s Secret
./deploy/eks/apply-manifests.sh        # thay ${ACCOUNT_ID}/${TAG} rồi apply 5 workload

kubectl get pods -n ecommerce -w
```

> Manifest để placeholder `${ACCOUNT_ID}` trong `image:`. `kubectl apply -f` thẳng sẽ apply
> nguyên chuỗi đó → `ImagePullBackOff`. Dùng `apply-manifests.sh`, hoặc mở file thay tay.

Chạy migration (tương đương one-off task của bậc 1):

```bash
kubectl apply -f infra/eks/manifests/40-migration-job.yaml
kubectl logs -f job/migrate-auth -n ecommerce
# chạy lại phải xoá job cũ trước — Job là immutable:
# kubectl delete job migrate-auth migrate-product migrate-order -n ecommerce
```

**Quay lại Console để xem kết quả:** cluster → tab **Resources** → chọn namespace `ecommerce`
→ **Workloads → Deployments / Pods**. Bấm vào pod xem Events và Logs — dễ đọc hơn `kubectl describe`
khi mới học, và giúp bạn hình dung cây object của k8s.

---

## Bước 6 — Ingress (Ngày 7)

Cần **AWS Load Balancer Controller** — cài bằng helm, Console không có nút.

```bash
# 1. IAM policy cho controller
curl -sO https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/main/docs/install/iam_policy.json
aws iam create-policy --policy-name AWSLoadBalancerControllerIAMPolicy \
  --policy-document file://iam_policy.json
```

**2. Bật OIDC provider cho cluster** (Console): cluster → tab **Overview** → mục
**OpenID Connect provider URL** → nút **Associate IAM OIDC provider** (nếu chưa có).
Hoặc: `eksctl utils associate-iam-oidc-provider --cluster ecommerce --approve`.

```bash
# 3. ServiceAccount + IRSA
eksctl create iamserviceaccount --cluster ecommerce --region us-east-1 \
  --namespace kube-system --name aws-load-balancer-controller \
  --attach-policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/AWSLoadBalancerControllerIAMPolicy \
  --approve

# 4. Cài controller
helm repo add eks https://aws.github.io/eks-charts && helm repo update
helm install aws-load-balancer-controller eks/aws-load-balancer-controller -n kube-system \
  --set clusterName=ecommerce \
  --set serviceAccount.create=false --set serviceAccount.name=aws-load-balancer-controller

# 5. Ingress
kubectl apply -f infra/eks/manifests/21-ingress.yaml
kubectl get ingress -n ecommerce -w        # chờ cột ADDRESS ra DNS (~2–3 phút)
```

Sau đó **EC2 → Load Balancers** trong Console sẽ thấy một ALB **mới xuất hiện mà bạn không hề bấm
Create**. Đối chiếu với bậc 1 (bạn tự tạo ALB tay ở bước 5) — đây chính là khác biệt
**imperative vs declarative**, và là một trong những điểm dễ ghi điểm nhất khi phỏng vấn.

> Ingress kẹt ở `ADDRESS <none>`:
> `kubectl logs -n kube-system deploy/aws-load-balancer-controller` — hầu như luôn là thiếu IRSA/policy.

**⚠️ Xoá Ingress TRƯỚC khi xoá cluster.** Xoá cluster trước → controller biến mất → ALB thành
mồ côi, vẫn tính $0.55/ngày và không có gì tự dọn.

---

## Bước 7 — HPA (Ngày 9)

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl top pods -n ecommerce            # ra số ⇒ OK; "unknown" ⇒ HPA sẽ vô dụng
kubectl apply -f infra/eks/manifests/30-hpa.yaml
kubectl get hpa -n ecommerce
```

Cột `TARGETS` hiện `<unknown>/70%` = metrics-server chưa chạy, **hoặc** Deployment thiếu
`resources.requests.cpu` (HPA tính % theo requests, không theo limits, không theo node).

---

## Bước 8 — Xem log và giám sát bằng Console

- **CloudWatch → Log groups → `/aws/eks/ecommerce/cluster`** — log control plane (API, audit).
- Log của **pod** thì mặc định **không** vào CloudWatch — nằm trên node, xem bằng
  `kubectl logs` hoặc tab **Resources** của cluster. Muốn đẩy lên CloudWatch phải cài add-on
  **Amazon CloudWatch Observability** (tab Add-ons) — nó tính tiền theo GB, cân nhắc với ngân sách.
- Đối chiếu bậc 1: ECS đẩy log lên CloudWatch **mặc định** qua log driver `awslogs`.
  Ở k8s bạn phải tự chọn giải pháp log — đây là một khác biệt vận hành thật, đáng nhớ.

---

## ✅ Checklist bậc 2

- [ ] `eksClusterRole` + `eksNodeRole`
- [ ] Cluster `ecommerce` `Active`, **cùng VPC với RDS**
- [ ] Node group `ng-1`, 2 × t3.medium **x86_64**, min = 0
- [ ] Add-on EBS CSI đã cài
- [ ] Subnet đã tag `kubernetes.io/role/elb=1` + Auto-assign public IPv4 = Yes
- [ ] Version cluster nằm trong **standard support**, và **Support type = Standard** (chặn $0.60/h)
- [ ] Tab **Resources** xem được (bootstrap admin access, hoặc access entry nếu principal khác)
- [ ] `sg-data` đã mở 5432/6379/5671 cho cluster security group
- [ ] `kubectl get nodes` → 2 node Ready
- [ ] 5 Deployment Running, migration Job `Completed`
- [ ] Ingress có ADDRESS, `curl http://<address>/health` → 200

## 💸 Trước khi tắt máy

**EKS → cluster → Compute → node group `ng-1` → Edit → Desired/Minimum = 0.**
Control plane vẫn $2.40/ngày — đó là giá giữ cluster, không tránh được (trừ khi xoá hẳn).

Xoá hẳn, **đúng thứ tự**:
1. `kubectl delete ingress --all -n ecommerce` (chờ ALB biến mất khỏi Console)
2. EKS → node group → Delete
3. EKS → cluster → Delete
