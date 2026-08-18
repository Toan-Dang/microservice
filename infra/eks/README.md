# Bậc 2 — EKS / Kubernetes (Ngày 5–11) 🟡 stretch giá trị cao

> Mục tiêu: dựng lại **chính hệ đó** trên Kubernetes. App và networking đã hiểu từ bậc 1
> → dồn 100% não học *riêng* k8s primitives. Đây là skill transferable, giá trị phỏng vấn cao nhất.

**Không provision lại stateful.** RDS / ElastiCache / Amazon MQ ở [`../common/`](../common/) dùng nguyên.
Chỉ lớp orchestration thay đổi.

## Hai đường

- 🖱️ **Bấm Console (học lần đầu)** → [`CONSOLE_GUIDE.md`](./CONSOLE_GUIDE.md)
  — kèm giải thích **vì sao EKS không làm hết bằng Console được** (ranh giới AWS ↔ Kubernetes).
- ⌨️ **CLI/eksctl (dựng lại nhanh)** → phần dưới đây

## Bản đồ ECS → EKS (học bằng cách đối chiếu)

| Bậc 1 (ECS Fargate) | Bậc 2 (EKS) | Khác biệt cốt lõi |
|---|---|---|
| task definition | `Deployment` (`spec.template`) | k8s tách "chạy cái gì" và "chạy bao nhiêu bản" rõ hơn |
| ECS service (`desiredCount`) | `Deployment` (`replicas`) | — |
| Cloud Map `*.microservice.local` | CoreDNS `*.svc.cluster.local` | k8s có DNS nội bộ sẵn, không phải service AWS riêng |
| — | `Service` (ClusterIP) | k8s có thêm 1 lớp VIP ổn định trước pod |
| ALB + target group **tạo tay** | `Ingress` + ALB Controller | **declarative**: khai báo, controller tự tạo/xoá ALB |
| `environment` trong task def | `ConfigMap` | tách config khỏi định nghĩa workload, sửa không cần đăng ký bản mới |
| `secrets[].valueFrom` + execution role | `Secret` / External Secrets + IRSA | — |
| ALB health check + grace period | `readinessProbe` **+** `livenessProbe` | k8s tách 2 khái niệm: "chưa sẵn sàng" ≠ "đã chết" |
| `ecs run-task` one-off | `Job` | — |
| execution role / task role | node IAM role / **IRSA** | IRSA = task role của k8s |
| Service Auto Scaling | `HorizontalPodAutoscaler` | — |

## ⚠️ Chọn phiên bản Kubernetes — đây là quyết định TIỀN, không chỉ kỹ thuật

Control plane tính **$0.10/h khi version còn standard support**, nhưng **$0.60/h khi rơi vào
extended support** — $2.40/ngày so với **$14.40/ngày**, gấp 6 lần, đủ để nuốt sạch ngân sách 15 ngày.
Mỗi minor version có standard support **14 tháng** kể từ khi lên EKS, sau đó tự động sang extended.

Tính tới **08/2026**: standard support = **1.34, 1.35, 1.36**; **1.33 đã hết ngày 29/07/2026**.
`cluster.yaml` dùng **1.35**. Kiểm tra lại trước khi tạo:

```bash
aws eks describe-cluster-versions --region us-east-1 \
  --query 'clusterVersions[].[clusterVersion,versionStatus,endOfStandardSupportDate]' --output table
```

Đây cũng là một câu trả lời phỏng vấn tốt: *"vì sao phải theo dõi lịch version của EKS"* —
không nâng cấp không chỉ là rủi ro bảo mật, nó là một hoá đơn gấp 6 lần.

## Chuẩn bị subnet (VPC có sẵn — BẮT BUỘC, dễ sót nhất)

`eksctl` **không tự tag subnet** của VPC bạn cung cấp. Thiếu tag thì lỗi xuất hiện muộn và mơ hồ:

```bash
CLUSTER=ecommerce
for s in $SUBNET_A $SUBNET_B; do
  aws ec2 create-tags --region us-east-1 --resources $s --tags \
    Key=kubernetes.io/role/elb,Value=1 \
    Key=kubernetes.io/cluster/$CLUSTER,Value=shared
done

# Public subnet phải tự gán public IP, nếu không node không ra được ECR (ta cố ý không dùng NAT)
aws ec2 describe-subnets --region us-east-1 --subnet-ids $SUBNET_A $SUBNET_B \
  --query 'Subnets[].[SubnetId,MapPublicIpOnLaunch]' --output table
# Nếu False:
# aws ec2 modify-subnet-attribute --subnet-id $SUBNET_A --map-public-ip-on-launch
```

| Thiếu gì | Triệu chứng |
|---|---|
| tag `kubernetes.io/role/elb=1` | Ingress kẹt mãi ở `ADDRESS <none>`, controller log báo không tìm thấy subnet |
| `MapPublicIpOnLaunch=false` | node `NotReady` / pod `ImagePullBackOff` — managed node group **không** tự gán public IP |

## Ngày 5–6 — dựng cluster + chạy 5 service

```bash
# 1. Điền vpc/subnet id thật vào cluster.yaml (PHẢI cùng VPC với RDS/Redis/MQ) và tag subnet như trên
aws ec2 describe-subnets --region us-east-1 \
  --filters Name=vpc-id,Values=$VPC_ID --query 'Subnets[].[SubnetId,AvailabilityZone]' --output table

# 2. Tạo cluster (~15–20 phút)
eksctl create cluster -f infra/eks/cluster.yaml
kubectl get nodes

# 3. Mở sg-data cho node group (pod phải vào được RDS/Redis/MQ)
./infra/eks/allow-nodes-to-data.sh

# 4. Config + secret + workload
kubectl apply -f infra/eks/manifests/00-namespace.yaml
#    sửa REDIS_URL thật trong 01-configmap.yaml trước:
kubectl apply -f infra/eks/manifests/01-configmap.yaml
./deploy/eks/create-secrets.sh                 # đọc Secrets Manager → kubectl create secret
./deploy/eks/apply-manifests.sh                # envsubst ${ACCOUNT_ID}/${TAG} rồi apply

kubectl get pods -n ecommerce -w
```

> Manifest để **placeholder** `${ACCOUNT_ID}` / `${AWS_REGION}` / `${TAG}` trong `image:`.
> `kubectl apply -f` thẳng sẽ apply nguyên chuỗi placeholder → `ImagePullBackOff`.
> Dùng `./deploy/eks/apply-manifests.sh` (chạy `envsubst` trước) hoặc thay tay.

## Ngày 7 — Ingress

```bash
helm repo add eks https://aws.github.io/eks-charts && helm repo update
helm install aws-load-balancer-controller eks/aws-load-balancer-controller -n kube-system \
  --set clusterName=ecommerce \
  --set serviceAccount.create=false --set serviceAccount.name=aws-load-balancer-controller

kubectl apply -f infra/eks/manifests/21-ingress.yaml
kubectl get ingress -n ecommerce -w        # chờ cột ADDRESS ra DNS của ALB (~2–3 phút)
curl http://$(kubectl get ingress api-gateway -n ecommerce -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')/health
```

> `helm install` tự apply CRD (`TargetGroupBinding`), nhưng `helm upgrade` **thì không** —
> nâng cấp controller về sau phải apply CRD tay từ repo `aws/eks-charts`.

ServiceAccount `aws-load-balancer-controller` đã được `cluster.yaml` tạo sẵn kèm IRSA — nên
`serviceAccount.create=false`. Bỏ qua bước đó là controller thiếu quyền, Ingress treo mãi ở
`ADDRESS <none>` mà không báo lỗi rõ (`kubectl logs -n kube-system deploy/aws-load-balancer-controller`).

## Ngày 8 — nối stateful + probe

- Endpoint RDS/Redis/MQ: **y hệt bậc 1**, chỉ đổi chỗ khai báo (ConfigMap/Secret thay vì task def).
- `readinessProbe` vs `livenessProbe` — khác biệt phải nói được:

| | readiness fail | liveness fail |
|---|---|---|
| Hậu quả | pod bị **rút khỏi Service**, không nhận traffic | pod **bị giết** và tạo lại |
| Dùng khi | app đang khởi động / tạm quá tải | app treo hẳn, không cứu được |

- ⚠️ **gRPC không dùng `httpGet` probe được** (không nói HTTP/1.1) → manifest dùng `tcpSocket`.
  Chuẩn hơn là gRPC health checking protocol + `grpc:` probe — cần thêm code vào service, ghi làm TODO.
- ⚠️ `livenessProbe` đặt `initialDelaySeconds` quá ngắn → pod bị giết khi NestJS còn đang boot →
  `CrashLoopBackOff` mà log app hoàn toàn sạch. Đây đúng là bẫy "grace period" của bậc 1, đổi tên.

## Ngày 9 — HPA + rolling update / rollback

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl top pods -n ecommerce                 # phải ra số; <unknown> thì HPA vô dụng
kubectl apply -f infra/eks/manifests/30-hpa.yaml

# rolling update + rollback
kubectl set image deploy/api-gateway api-gateway=<ecr>/api-gateway:<sha> -n ecommerce
kubectl rollout status deploy/api-gateway -n ecommerce
kubectl rollout undo   deploy/api-gateway -n ecommerce      # thứ ECS không có sẵn tương đương 1 lệnh
```

## Ngày 10 — CI/CD sang EKS

Delta nhỏ vì pipeline build/push đã có từ Ngày 3 → xem [`../../cicd/README.md`](../../cicd/README.md).

## Ngày 11 — bonus: Postgres bằng StatefulSet + PVC

[`manifests/90-postgres-statefulset.yaml`](./manifests/90-postgres-statefulset.yaml) — **cố tình làm
cái mà production không làm**, để tận mắt thấy vì sao. File có sẵn kịch bản 5 thí nghiệm
(xoá pod → data còn; xoá PVC → data mất; scale 2 → 2 Postgres độc lập không replicate).

Kiểu hiểu *"tôi biết làm, và biết vì sao production không làm thế"* rất được đánh giá cao.

## Debug — 5 lệnh dùng 90% thời gian

```bash
kubectl get pods -n ecommerce                          # trạng thái tổng quan
kubectl describe pod <pod> -n ecommerce                # Events ở cuối = lý do thật
kubectl logs <pod> -n ecommerce --previous             # log của lần chạy TRƯỚC khi crash
kubectl get events -n ecommerce --sort-by=.lastTimestamp
kubectl exec -it <pod> -n ecommerce -- sh              # vào trong pod thử nc/psql
```

| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| `ImagePullBackOff` | placeholder `${ACCOUNT_ID}` chưa thay, hoặc node role thiếu quyền ECR |
| `CrashLoopBackOff`, log sạch | `livenessProbe` giết pod khi app chưa boot xong |
| `Pending` mãi | `resources.requests` quá cao so với node, hoặc node group đang ở 0 |
| `CreateContainerConfigError` | thiếu key trong ConfigMap/Secret mà manifest tham chiếu |
| gRPC `DEADLINE_EXCEEDED` | sai FQDN trong ConfigMap, hoặc `GRPC_URL` bind `localhost` |
| RDS timeout từ pod | quên mở `sg-data` cho SG của node group (bước 3) |
| Ingress `ADDRESS <none>` | ALB Controller chưa cài / thiếu IRSA / **subnet thiếu tag `kubernetes.io/role/elb=1`** |
| HPA `<unknown>` | chưa cài metrics-server, hoặc Deployment thiếu `resources.requests.cpu` |

## 💸 Trước khi nghỉ mỗi ngày

```bash
eksctl scale nodegroup --cluster ecommerce --name ng-1 --nodes 0 --nodes-min 0
```

Control plane vẫn tính $2.40/ngày dù cluster rỗng (và **$14.40/ngày** nếu version rơi vào
extended support) — đó là giá phải trả để giữ cluster.
Xoá hẳn thì **`kubectl delete ingress --all -n ecommerce` TRƯỚC** `eksctl delete cluster`,
nếu không ALB thành mồ côi. Xem [`../common/COST_PLAN.md`](../common/COST_PLAN.md) §4.
