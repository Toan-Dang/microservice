# Console Guide — Bậc 2: EKS (Ngày 5–11)

> **Bản bấm chuột.** Bản CLI tương ứng: [`cluster.yaml`](./cluster.yaml) + `eksctl`,
> [`allow-nodes-to-data.sh`](./allow-nodes-to-data.sh).

> **Trạng thái đối chiếu (26/08/2026).**
> ✅ Tạo cluster (Configuration options + wizard 6 trang, `Support type`, `Cluster access`),
> node group (4 trang, đủ field label), **access entry (wizard 3 trang)**, **OIDC provider (không có
> nút trong EKS Console — làm ở IAM hoặc eksctl)**, lịch version 1.34/1.35/1.36 — **đã đối chiếu** docs AWS.
> ✅ **Kiểm chứng bằng lỗi thật trên account:** Free Tier plan chặn t3.medium (`CREATE_FAILED`) → bảng
> instance free-tier x86_64 thay thế ở Bước 3; migration job phải qua `apply-manifests.sh` (envsubst),
> `kubectl apply -f` thẳng → `InvalidImageName`, đã sửa Bước 5.
> ⚠️ Tag subnet, IAM role use-case label — dựa trên docs nhưng chưa soi từng nhãn màn hình.

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

## Bước 0 — Cài công cụ trên máy

**macOS (Homebrew) — cách gọn nhất, tự đúng cả Intel lẫn Apple Silicon:**

```bash
# kubectl + helm (thao tác cluster) — cộng aws/jq/gettext cho các script deploy ở bước 5–6
brew install kubectl helm awscli jq gettext
kubectl version --client && helm version && aws --version && jq --version && envsubst --version | head -1
```

> ⚠️ **macOS KHÔNG có sẵn `envsubst`, `aws`, `jq`** — thiếu là chặn đúng các script bạn sẽ chạy:
> - `apply-manifests.sh` (bước 5–6) gọi **`envsubst`** để thay `${ACCOUNT_ID}/${AWS_REGION}/${TAG}`;
>   `envsubst` nằm trong gói **`gettext`** (không phải `envsubst`). Thiếu → script thoát ngay
>   *"Thiếu envsubst (gói gettext)"*, còn `kubectl apply -f` thẳng thì pod `InvalidImageName`.
> - `create-secrets.sh` (bước 5) cần **`aws`** (đọc Secrets Manager) + **`jq`** (parse JSON).
>
> `gettext` là **keg-only** trên macOS nhưng Homebrew vẫn symlink riêng binary `envsubst` vào
> `/opt/homebrew/bin` (Apple Silicon) / `/usr/local/bin` (Intel), nên gõ `envsubst` là chạy được luôn,
> không cần `brew link`. Kiểm chứng bằng dòng `envsubst --version` ở trên.

> 💡 Các script deploy để `#!/usr/bin/env bash`. macOS mặc định là **zsh** và kèm **bash 3.2** (cũ),
> nhưng script chỉ dùng array thường + process substitution — chạy tốt trên bash 3.2, không cần
> nâng bash. Cứ chạy `./deploy/eks/*.sh` bình thường.

**Linux:**

```bash
# kubectl
curl -sLO "https://dl.k8s.io/release/$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -m 0755 kubectl /usr/local/bin/kubectl && kubectl version --client

# helm (cần cho AWS Load Balancer Controller ở bước 6)
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

> ⚠️ Bản `curl` ở trên là **binary `linux/amd64`** — chạy trên macOS sẽ tải nhầm kiến trúc
> (macOS cần `darwin/arm64` hoặc `darwin/amd64`). Trên macOS luôn dùng `brew` để khỏi chọn tay.

`eksctl` **không bắt buộc** để *tạo cluster* bằng Console — nhưng **Bước 6 (IRSA + OIDC provider)
lại cần nó**, nên cài luôn cho đỡ quay lại: `brew install eksctl` (macOS). Nó cũng gộp ~10 bước bấm
tạo cluster thành 1 lệnh — bản CLI ở [`cluster.yaml`](./cluster.yaml).

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

Đầu tiên là **màn chọn Configuration options**, sau đó là **wizard 6 trang** (Configure cluster →
Specify networking → Configure observability → Select add-ons → Configure selected add-ons settings →
Review and create). Điền như sau:

**Màn chọn đầu — Configuration options**

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
| section **Cluster access** → Bootstrap cluster administrator access | radio **Allow cluster administrator access** (mặc định — để nguyên) | người tạo cluster **tự động** là Kubernetes admin |
| section **Cluster access** → Cluster authentication mode | **EKS API and ConfigMap** | dùng được cả access entry (mới) lẫn `aws-auth` (cũ) |

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
| Instance types | **t3.medium** (nếu account bị Free Tier plan chặn → xem cảnh báo dưới) |
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
> 🛑 **Bẫy "Free Tier plan" (tài khoản mới, từ ~2025):** node group sẽ vào `CREATE_FAILED` với
> `AsgInstanceLaunchFailures` — *"The specified instance type is not eligible for Free Tier"*.
> `kubectl get nodes` khi đó trả **"No resources found"** (control plane vẫn `ACTIVE`, chỉ là 0 node
> join). Nguyên nhân: account đang ở **Free plan**, chặn launch mọi instance không free-tier.
> `CREATE_FAILED` **không sửa bằng Edit** — phải `aws eks delete-nodegroup ... && aws eks wait
> nodegroup-deleted ...` rồi tạo lại.
>
> **2 hướng xử lý:**
> - **Nâng account lên Paid plan** (Billing → Account/Free Tier → *Upgrade to paid plan*) rồi tạo lại với `t3.medium`.
> - **Hoặc giữ Free plan, chọn instance free-tier-eligible + đủ RAM.** Xem account cho phép gì:
>   `aws ec2 describe-instance-types --region us-east-1 --filters Name=free-tier-eligible,Values=true --query 'InstanceTypes[].InstanceType'`
>
> | Instance | RAM | Arch | Dùng thay t3.medium? |
> |---|---|---|---|
> | `c7i-flex.large` | 4 GB | x86_64 | ✅ tốt nhất — bằng RAM t3.medium |
> | `m7i-flex.large` | 8 GB | x86_64 | ✅ dư sức |
> | `t3.small` | 2 GB | x86_64 | ⚠️ chật |
> | `t3.micro` | 1 GB | x86_64 | ❌ quá yếu (≤4 pod IP/node, không đủ CoreDNS + app) |
> | `t4g.*` | — | **arm64** | ❌ Graviton → `exec format error` |
>
> Danh sách free-tier-eligible **khác nhau tuỳ account/region** — luôn chạy lệnh trên để lấy đúng của bạn.
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

**Bạn thường KHÔNG phải làm gì.** Kéo xuống cuối trang `Configure cluster`, có section **Cluster
access**. Trong đó mục **Bootstrap cluster administrator access** là **2 radio** (không phải toggle
bật/tắt):

- **Allow cluster administrator access** ← **mặc định đã chọn sẵn**
- Disallow cluster administrator access

Để nguyên lựa chọn mặc định nghĩa là **principal tạo cluster tự động là Kubernetes admin** — vào
cluster, mở tab **Resources** là **xem được ngay các object Kubernetes bên trong cluster**:
Workloads (Deployment / Pod / ReplicaSet / Job), Service & networking (Service / Ingress), Config &
secrets... mà không phải làm gì thêm. (`Cluster authentication mode` cũng nằm ngay trong section này.)

> 🛑 **DỪNG nếu bạn đăng nhập bằng CHÍNH tài khoản tạo cluster.** Bootstrap access đã tự tạo sẵn
> access entry cho bạn — **không cần và không thể tạo thêm**. Nếu cứ bấm Create access entry cho
> đúng principal đó, Console báo *"The specified access entry resource is already in use on this
> cluster."* Đây **không phải lỗi** — nó xác nhận bạn đã có quyền. Cứ mở thẳng tab **Resources**.
> (Muốn kiểm chứng: tab **Access** sẽ liệt kê sẵn một access entry ứng với principal của bạn.)

Chỉ làm bước dưới khi bạn xem cluster bằng **user/role KHÁC** với lúc tạo (ví dụ tạo bằng
`eksctl` với profile A, xem Console bằng SSO user B), hoặc khi bạn đã chọn *Disallow cluster
administrator access* lúc tạo:

Cluster → tab **Access** → **Create access entry**. Đây là **wizard 3 trang**, không phải 1 form:

**Trang 1 — Configure access entry**

| Trường | Chọn |
|---|---|
| **IAM principal** | dropdown chọn **role/user có sẵn** đang đăng nhập Console (không còn gõ tay ARN) |
| Type | **Standard** (mặc định — để nguyên) |
| Username / Groups / Tags | bỏ trống (dùng access policy ở trang sau, không cần RBAC group thủ công) |

→ **Next**.

**Trang 2 — Add access policy** — bấm **Add policy**, rồi:

| Trường | Chọn |
|---|---|
| Policy name | `AmazonEKSClusterAdminPolicy` |
| Access scope | **Cluster** |

→ **Next**.

**Trang 3 — Review and create** → **Create**.

> ⚠️ Dễ vấp: nếu ở trang 2 **không bấm `Add policy`** mà Next luôn, access entry vẫn tạo được
> nhưng principal **không có quyền gì** — tab Resources vẫn báo lỗi y như chưa làm. Type Standard mà
> bỏ trống cả Groups lẫn access policy = tạo entry rỗng.

> Triệu chứng khi thiếu: tab **Resources** báo *"Your current IAM principal doesn't have access
> to Kubernetes objects on this cluster"*. Bài học vẫn giữ nguyên giá trị: quyền AWS (IAM) và quyền
> trong cluster (Kubernetes RBAC) là **hai lớp riêng biệt** — chỉ là EKS đã tự bắc cầu cho người tạo.

### 4c. Tag subnet (BẮT BUỘC — Console không tự làm)

**Trước hết, biết subnet nào là của cluster:** EKS → cluster `ecommerce` → tab **Networking** → mục
**Subnets** liệt kê các `subnet-xxxx` cluster đang dùng. Copy các ID đó.

Rồi **VPC → Subnets** (service **VPC**, không phải EC2) → lọc/tìm theo đúng các ID vừa copy → chọn
từng subnet → tab **Tags** → **Manage tags**:

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

> ⚠️ **Mọi manifest có `image:` đều để placeholder `${ACCOUNT_ID}/${AWS_REGION}/${TAG}`** — kể cả
> `40-migration-job.yaml`. `kubectl apply -f` **thẳng** sẽ apply nguyên chuỗi `${...}`; vì `${}` là ký
> tự **không hợp lệ** trong image ref, pod chết ngay với **`InvalidImageName`** (KHÔNG phải
> `ImagePullBackOff` — cái đó là khi tên image hợp lệ nhưng kéo không được). **Luôn đi qua
> `apply-manifests.sh`** (nó `envsubst` hộ), kể cả cho file chạy riêng — truyền tên file làm tham số.

Chạy migration (tương đương one-off task của bậc 1). `40-migration-job.yaml` **không** nằm trong
danh sách mặc định của `apply-manifests.sh` (nó là job chạy-một-lần), nên **truyền thẳng tên file**
vào script để vẫn được thay placeholder:

```bash
# ĐÚNG: qua script (envsubst) — KHÔNG dùng `kubectl apply -f` thẳng file này
TAG=<git-sha> ./deploy/eks/apply-manifests.sh infra/eks/manifests/40-migration-job.yaml
kubectl logs -f job/migrate-auth -n ecommerce
# chạy lại phải xoá job cũ trước — Job là immutable:
# kubectl delete job migrate-auth migrate-product migrate-order -n ecommerce
```

> `TAG` mặc định = `git rev-parse --short HEAD`; chỉ cần set tay nếu image trên ECR gắn tag khác
> commit đang checkout. `ACCOUNT_ID` script tự lấy qua `aws sts`, `AWS_REGION` mặc định `us-east-1`.

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

**2. Tạo IAM OIDC provider cho cluster.** ⚠️ **EKS Console KHÔNG có nút "Associate IAM OIDC
provider".** Tab **Overview** của cluster chỉ *hiển thị* giá trị **OpenID Connect provider URL** để
bạn copy, chứ không tạo hộ. Có 2 đường tạo thật:

- **Cách nhanh (khuyến nghị) — `eksctl` lo trọn gói:**
  ```bash
  eksctl utils associate-iam-oidc-provider --cluster ecommerce --region us-east-1 --approve
  ```
- **Cách bằng Console — làm ở IAM, không phải EKS:** copy OIDC URL ở tab Overview → mở **IAM
  Console → Identity providers → Add provider** → Provider type **OpenID Connect** → dán URL vào
  **Provider URL** → **Audience** = `sts.amazonaws.com` → **Add provider**.

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
  --set region=us-east-1 \
  --set vpcId=vpc-xxxxxxxx \                # ⚠️ VPC của cluster — xem cảnh báo dưới
  --set serviceAccount.create=false --set serviceAccount.name=aws-load-balancer-controller

# 5. Ingress
kubectl apply -f infra/eks/manifests/21-ingress.yaml
kubectl get ingress -n ecommerce -w        # chờ cột ADDRESS ra DNS (~2–3 phút)
```

> 🛑 **BẮT BUỘC truyền `--set region` + `--set vpcId`, nếu không controller sẽ CrashLoopBackOff.**
> Không có 2 flag này, controller phải tự đi hỏi **EC2 instance metadata (IMDS)** để lấy VPC ID.
> Trên EKS, pod thường **không với tới IMDS** (IMDSv2 mặc định `hop-limit=1`, mà gói tin từ pod cần
> thêm 1 hop nữa) → log báo `failed to get VPC ID ... context deadline exceeded` → pod chết.
> Lấy VPC ID của cluster:
> ```bash
> aws eks describe-cluster --name ecommerce --region us-east-1 \
>   --query 'cluster.resourcesVpcConfig.vpcId' --output text
> ```
> Nếu đã lỡ `helm install` thiếu 2 flag, không cần gỡ — vá bằng:
> ```bash
> helm upgrade aws-load-balancer-controller eks/aws-load-balancer-controller -n kube-system \
>   --reuse-values --set region=us-east-1 --set vpcId=vpc-xxxxxxxx
> ```

> ⚠️ **Lỗi khi apply Ingress: `no endpoints available for service "aws-load-balancer-webhook-service"`.**
> Đây **không phải** file `21-ingress.yaml` sai. Ingress mới đi qua một *validating webhook* do
> controller phục vụ; báo "no endpoints" nghĩa là **pod controller đứng sau webhook đó chưa Ready**
> (thường là CrashLoopBackOff vì lỗi IMDS ở trên). Phản xạ đúng — soi pod, **đừng sửa manifest**:
> ```bash
> kubectl get pods -n kube-system -l app.kubernetes.io/name=aws-load-balancer-controller
> kubectl logs  -n kube-system -l app.kubernetes.io/name=aws-load-balancer-controller --tail=40
> ```
> Controller Ready (`1/1`) → webhook có endpoint → apply lại Ingress là được.

Sau đó **EC2 → Load Balancers** trong Console sẽ thấy một ALB **mới xuất hiện mà bạn không hề bấm
Create**. Đối chiếu với bậc 1 (bạn tự tạo ALB tay ở bước 5) — đây chính là khác biệt
**imperative vs declarative**, và là một trong những điểm dễ ghi điểm nhất khi phỏng vấn.

> Ingress kẹt ở `ADDRESS <none>`:
> `kubectl logs -n kube-system deploy/aws-load-balancer-controller` — hầu như luôn là thiếu IRSA/policy.

**⚠️ Xoá Ingress TRƯỚC khi xoá cluster.** Xoá cluster trước → controller biến mất → ALB thành
mồ côi, vẫn tính $0.55/ngày và không có gì tự dọn.

---

## Bước 7 — HPA (Ngày 9)

HPA cần **metrics-server**. **KIỂM TRA nó có sẵn chưa TRƯỚC KHI cài** — cluster này đã bật
`metrics-server` dưới dạng **EKS managed add-on** (chọn ở Bước 2/4a), nên **không cài lại bằng YAML**:

```bash
# 1. Có metrics-server chưa? (EKS add-on hoặc đã cài trước đó)
aws eks list-addons --cluster-name ecommerce --region us-east-1 | grep metrics-server
kubectl get deploy metrics-server -n kube-system

# 2a. NẾU đã có (như cluster này) → BỎ QUA việc cài, đo luôn:
kubectl top pods -n ecommerce            # ra số ⇒ OK; "unknown" ⇒ HPA sẽ vô dụng

# 2b. CHỈ khi thật sự chưa có metrics-server ở đâu cả mới cài bản upstream:
# kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

kubectl apply -f infra/eks/manifests/30-hpa.yaml
kubectl get hpa -n ecommerce
```

> 🛑 **KHÔNG `kubectl apply` bản upstream đè lên metrics-server đã có (nhất là bản EKS add-on).**
> Bản upstream và bản EKS có **labels/selector khác nhau**, nên apply đè sẽ hỏng nửa vời:
> - Deployment fail: `spec.selector: field is immutable` + `Duplicate value "https"` (selector của
>   Deployment không sửa được sau khi tạo).
> - Nguy hiểm hơn: nó **patch được** Service — thêm `k8s-app` vào selector mà pod EKS không có label
>   đó → Service khớp **0 pod** → `endpoints <none>` → APIService `v1beta1.metrics.k8s.io` thành
>   `MissingEndpoints` → **`kubectl top` báo `Metrics API not available`**. Trông như metrics-server
>   chết, thực ra chỉ là Service trỏ sai.
>
> **Sửa (khôi phục add-on về config chuẩn của EKS, dọn luôn các resource bị đè):**
> ```bash
> aws eks update-addon --cluster-name ecommerce --addon-name metrics-server \
>   --region us-east-1 --resolve-conflicts OVERWRITE
> # chờ ACTIVE rồi kiểm chứng:
> aws eks describe-addon --cluster-name ecommerce --addon-name metrics-server \
>   --region us-east-1 --query 'addon.status' --output text
> kubectl get apiservice v1beta1.metrics.k8s.io   # AVAILABLE phải = True
> kubectl top pods -n ecommerce
> ```
> Muốn **nâng version** metrics-server thì đi qua add-on (`aws eks update-addon --addon-version ...`),
> **không** apply YAML tay.

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
