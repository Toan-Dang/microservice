# Console Guide — Bậc 1: ECS Fargate (Ngày 2)

> **Bản bấm chuột.** Bản CLI tương ứng: [`setup-cluster.sh`](./setup-cluster.sh),
> [`setup-alb.sh`](./setup-alb.sh), [`create-services.sh`](./create-services.sh).
>
> **Trạng thái đối chiếu (18/08/2026).**
> ✅ Task definition (JSON editor + form), tạo ECS service, Run new task (Container Overrides) —
> **đã đối chiếu** với trang Console trong docs AWS và đã sửa lại theo đúng tên mục hiện tại.
> ⚠️ Tạo cluster ECS, Target group + ALB (Console EC2), IAM role — chưa đối chiếu lại lần này.

> Điều kiện: đã xong [`../common/CONSOLE_GUIDE.md`](../common/CONSOLE_GUIDE.md).
> Cần sẵn trong tay: `sg-alb`, `sg-app`, `sg-data`, endpoint Redis, 6 ký tự đuôi ARN secret,
> **Account ID** (góc trên phải Console → menu tài khoản).

Thứ tự bấm — **không đảo**, mỗi bước sau cần output của bước trước:

```
1. IAM role (2 cái)   →  2. Cloud Map namespace  →  3. ECS cluster
      →  4. Task definition (5)  →  5. Target group + ALB  →  6. ECS service (5)
      →  7. Migration/seed one-off  →  8. Verify
```

---

## Bước 1 — 2 IAM role

Đây là chỗ người mới hay nhầm nhất, nên làm trước và hiểu rõ:

| Role | **Ai** dùng | Dùng để làm gì |
|---|---|---|
| **Task execution role** | ECS agent, **trước khi** container chạy | kéo image ECR, đọc Secrets Manager, tạo log group |
| **Task role** | code **trong** container (AWS SDK) | gọi SES gửi email |

Gán nhầm chỗ: quyền secret đặt ở task role → task **không start nổi**
(`ResourceInitializationError`); quyền SES đặt ở execution role → container chạy nhưng
SES `AccessDenied`. Đây gần như chắc chắn sẽ bị hỏi khi phỏng vấn.

### 1a. `ecommerceTaskExecutionRole`

**Console → IAM → Roles → Create role**

| Trường | Chọn |
|---|---|
| Trusted entity type | **AWS service** |
| Service or use case | **Elastic Container Service** → use case **Elastic Container Service Task** |
| Permissions policies | tick `AmazonECSTaskExecutionRolePolicy` |
| Role name | `ecommerceTaskExecutionRole` |

Tạo xong → mở role → **Add permissions → Create inline policy** → tab **JSON**:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["secretsmanager:GetSecretValue"],
    "Resource": "arn:aws:secretsmanager:us-east-1:<ACCOUNT_ID>:secret:ecommerce/app-*"
  }]
}
```

Đặt tên `read-app-secret` → Create.

> `AmazonECSTaskExecutionRolePolicy` **không** bao gồm quyền Secrets Manager. Bỏ qua inline policy
> này là task chết ngay lúc khởi động, và thông báo lỗi nói về "unable to pull secrets" chứ không
> nói "thiếu quyền" — dễ đi tìm nhầm hướng.

### 1b. `ecommerceTaskRole`

Tạo giống hệt, **không** tick policy nào ở bước Permissions, tên `ecommerceTaskRole`.
Tạo xong → **Create inline policy** → JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["ses:SendEmail", "ses:SendRawEmail"],
    "Resource": "*"
  }]
}
```

Tên `send-email`.

---

## Bước 2 — Cloud Map namespace (service discovery)

**Console → AWS Cloud Map → Namespaces → Create namespace**

| Trường | Giá trị |
|---|---|
| Namespace name | `microservice.local` |
| Instance discovery | **API calls and DNS queries in VPCs** |
| VPC | VPC default (cùng VPC với RDS) |

Tạo mất ~1 phút. Đây là thứ biến `auth-service.microservice.local:50051` thành địa chỉ gọi được —
tương đương CoreDNS ở bậc 2.

> Bạn **không** phải tự tạo "service" bên trong namespace. Ở bước 6, khi tạo ECS service với
> Service Discovery bật, ECS tự tạo và tự đăng ký IP task vào đây.

---

## Bước 3 — ECS cluster

**Console → Elastic Container Service → Clusters → Create cluster**

| Trường | Giá trị |
|---|---|
| Cluster name | `ecommerce` |
| Infrastructure | tick **AWS Fargate (serverless)**, **bỏ tick** Amazon EC2 instances |
| Monitoring / Container Insights | tắt (tính tiền theo metric) |

Cluster tạo xong là một cái vỏ rỗng — chưa tốn đồng nào cho tới khi có task chạy.

---

## Bước 4 — Task definition (làm 5 lần)

**Console ECS mới: [https://console.aws.amazon.com/ecs/v2](https://console.aws.amazon.com/ecs/v2)**
→ navigation **Task definitions** → menu **Create new task definition** → **Create new task
definition with JSON**.

**Dùng đường JSON**, nhanh hơn form và khớp đúng file trong repo. Mở
[`taskdef/<service>.json`](./taskdef/), dán vào ô editor, rồi **thay 5 placeholder**:

| Placeholder | Thay bằng |
|---|---|
| `${ACCOUNT_ID}` | Account ID 12 số |
| `${AWS_REGION}` | `us-east-1` |
| `${TAG}` | `latest` (hoặc git SHA bạn đã push) |
| `${REDIS_HOST}` | Primary endpoint ElastiCache (không kèm `:6379`) |
| `${SECRET_SUFFIX}` | 6 ký tự đuôi ARN secret |

Editor JSON có kiểm tra: file phải hợp lệ, **không được chứa key lạ**, phải có `family`, và
`containerDefinitions` có ít nhất 1 phần tử. Nếu báo lỗi key lạ → bạn dán nhầm output của
`describe-task-definition` (nó có thêm `taskDefinitionArn`, `revision`, `status`… là field chỉ-đọc).

Lặp cho cả 5 file. Nếu muốn dùng form thay vì JSON, các ô theo đúng thứ tự Console:

| Trường | Giá trị |
|---|---|
| Task definition family | tên service |
| **Launch type** | **AWS Fargate** (mặc định Console) |
| **Operating system/Architecture** | **Linux/X86_64** |
| **Task size** → CPU / Memory | **0.25 vCPU** / **0.5 GB** |
| **Network mode** | **awsvpc** (mặc định) |
| **Task roles** → Task role | `ecommerceTaskRole` |
| **Task roles** → Task execution role | `ecommerceTaskExecutionRole` |
| Container → Name / Image URI | tên service / `<acct>.dkr.ecr.us-east-1.amazonaws.com/<svc>:latest` |
| Container → Essential container | **Essential** |
| Container → Port mappings | 3000 (gateway) / 50051–53 (gRPC) / **xoá hết** (notification-worker) |
| Container → **Environment variables** | xem bảng trong [README.md](./README.md) |
| Container → Environment variables (biến secret) | **Key** = tên biến (vd `JWT_SECRET`), đổi kiểu sang **ValueFrom**, **Value** = ARN đầy đủ `arn:...:secret:ecommerce/app-AbCdEf:JWT_SECRET::` |
| Container → **Use log collection** | bật, đích **Amazon CloudWatch** (mặc định) |

> ⚠️ Hai dấu `::` ở cuối ARN secret là **bắt buộc** (chỗ trống dành cho version-stage và version-id).
> Thiếu → ECS báo secret không hợp lệ.

Task definition là **immutable**: mỗi lần Save là một **revision** mới (`api-gateway:1`, `:2`…).
Không sửa được tại chỗ — đây là điểm khác biệt với `Deployment` của k8s.

---

## Bước 5 — Target group + ALB

Phải tạo **target group trước**, vì trình tạo ALB bắt chọn target group ngay.

### 5a. Target group

**Console → EC2 → Load Balancing → Target Groups → Create target group**

| Trường | Giá trị |
|---|---|
| Choose a target type | **IP addresses** ⚠️ |
| Target group name | `ecommerce-gw-tg` |
| Protocol / Port | HTTP / **3000** |
| VPC | default VPC |
| Health check path | **`/health`** |
| Advanced → Healthy threshold | 2 |
| Advanced → Interval | 30 giây |
| **Register targets** | **bỏ trống, bấm Next/Create luôn** |

> **`IP addresses` chứ không phải `Instances`** — Fargate dùng networking mode `awsvpc`, mỗi task
> có ENI riêng nên target là IP, không có EC2 instance nào để chọn. Chọn nhầm `Instances` thì
> đến bước 6 ECS sẽ không cho gắn target group.
>
> Không đăng ký target tay: ECS service tự đăng ký/gỡ IP task mỗi lần deploy.

### 5b. Application Load Balancer

**EC2 → Load Balancers → Create load balancer → Application Load Balancer**

| Trường | Giá trị |
|---|---|
| Name | `ecommerce-alb` |
| Scheme | **Internet-facing** |
| IP address type | IPv4 |
| VPC / Mappings | default VPC, tick **ít nhất 2 Availability Zone** |
| Security groups | `ecommerce-sg-alb` (**bỏ** `default`) |
| Listener | HTTP : 80 → Default action **Forward to** `ecommerce-gw-tg` |

Tạo xong → copy **DNS name** (dạng `ecommerce-alb-123456.us-east-1.elb.amazonaws.com`).

> Target group sẽ hiện **unused/unhealthy** cho tới khi có ECS service đăng ký target ở bước 6.
> Đó là bình thường, đừng đi sửa health check.

---

## Bước 6 — ECS service (làm 5 lần)

**Console → ECS → Clusters → `ecommerce` → tab Services → Create**

Phần chung cho cả 5:

| Mục | Trường | Giá trị |
|---|---|---|
| Service details | Task definition **family** / **Revision** | tên service / `LATEST` |
| Service details | Service name | tên service (trùng family cho dễ) |
| **Compute configuration** | | **Launch type** → **FARGATE**, Platform version `LATEST` ⚠️ |
| **Deployment configuration** | Service type | **Replica** |
| **Deployment configuration** | Desired tasks | **1** |
| **Deployment configuration** | **Health check grace period** | **90** (chỉ api-gateway cần, xem dưới) |
| **Deployment configuration** → Deployment failure detection | | để mặc định (circuit breaker + rollback) |
| **Networking** | VPC | default VPC |
| **Networking** | Subnets | chọn **≥2 subnet** |
| **Networking** | Security group | **Use an existing** → `ecommerce-sg-app` (bỏ default) |
| **Networking** | **Public IP** | **Turned on** ⚠️ |
| **Service discovery** (mục gập, mặc định tắt) | | tick **Use service discovery** |
| | Configure namespace | **Select an existing namespace** → `microservice.local` |
| | Service discovery name | tên service (`auth-service`, …) |
| | DNS record type / TTL | **A** / `15` |

> ⚠️ **Compute configuration mặc định là `Capacity provider strategy`, không phải `Launch type`.**
> Phải bấm chuyển sang **Launch type → FARGATE**. Để nguyên capacity provider vẫn chạy được,
> nhưng lệch với task definition và script CLI trong repo (`--launch-type FARGATE`).

> ⚠️ **Health check grace period nằm trong `Deployment configuration`**, không nằm trong mục
> Load balancing như nhiều hướng dẫn cũ. Mặc định là **0**.

> ℹ️ **Deployment failure detection** mặc định bật **deployment circuit breaker + Rollback on failures**:
> deploy hỏng thì ECS tự quay về bản chạy được. Rất tiện, nhưng phải biết — nếu không bạn sẽ thấy
> "deploy xong mà code vẫn cũ" và tưởng pipeline sai.

> ℹ️ **Service Connect vs Service discovery**: Console có cả hai mục. Kế hoạch này dùng
> **Service discovery** (Cloud Map, DNS thuần) vì nó ánh xạ 1-1 sang CoreDNS ở bậc 2 — dễ so sánh.
> **Service Connect** là cách mới hơn của ECS (proxy sidecar, có retry/metrics sẵn) nhưng **không có
> tương đương trực tiếp** ở k8s trần, nên dùng nó sẽ làm mờ đúng thứ ta muốn học. Nói được lựa chọn
> này khi phỏng vấn là điểm cộng.

> ⚠️ **Public IP bắt buộc bật.** Task nằm ở public subnet nhưng không có public IP thì không ra
> được internet để kéo image từ ECR → kẹt `PENDING` rồi `STOPPED` với `CannotPullContainerError`.
> (Đường chuẩn production là private subnet + NAT Gateway ~$1/ngày — ta cố tình không dùng.)

### Riêng `api-gateway` — thêm phần Load balancing

| Trường | Giá trị |
|---|---|
| Load balancer type | **Application Load Balancer** |
| Container to load balance | `api-gateway 3000:3000` |
| Use an existing load balancer | `ecommerce-alb` |
| Listener | **Use an existing listener** → `80:HTTP` |
| Target group | **Use an existing target group** → `ecommerce-gw-tg` |

Và đặt **Health check grace period = 90** ở mục **Deployment configuration** (phía trên).

> Grace period 90s: NestJS boot mất vài giây + nối Redis. Để mặc định 0 thì ALB đánh unhealthy
> ngay và ECS giết task trước khi app kịp sẵn sàng → vòng lặp restart vô tận, log app hoàn toàn sạch.

### 4 service còn lại

Tạo y hệt phần chung, **không** bật Load balancing. Chúng không bao giờ ra internet.
`notification-worker` cũng **không** cần service discovery (không ai gọi vào nó) — bật cũng không sao.

Theo dõi: tab **Tasks** của cluster, chờ `Last status = RUNNING`.

---

## Bước 7 — Migration & seed (one-off task)

Prod **không** bật `SEED_ON_BOOT` → `GET /products` sẽ trả `[]` cho tới khi bạn seed.

**ECS → Clusters → `ecommerce` → tab Tasks → Run new task**

| Mục | Trường | Giá trị |
|---|---|---|
| **Compute configuration** | | **Launch type** → **FARGATE** |
| **Deployment configuration** | Task definition | `auth-service`, revision LATEST |
| **Deployment configuration** | Desired tasks | `1` |
| **Networking** | | như bước 6 (subnet, `sg-app`, **Public IP on**) |
| **Container Overrides** → gập tên container | **Command override** | dán chuỗi dưới đây |

Migration (làm cho `auth-service`, `product-service`, `order-service`):

```
node,node_modules/typeorm/cli.js,migration:run,-d,dist/database/data-source.js
```

Seed (làm cho `auth-service`, `product-service`):

```
npm,run,seed:prod
```

> Ô **Command override** nằm trong mục **Container Overrides** (phải gập ra, rồi gập tiếp tên
> container). Console nhận **danh sách ngăn bằng dấu phẩy, không có khoảng trắng sau dấu phẩy** —
> thừa khoảng trắng là thành đối số riêng và lệnh chạy sai.
>
> Tài liệu AWS chỉ ghi *"enter the Docker command"* mà không nói rõ định dạng. Nếu Console hiểu sai
> chuỗi trên, dùng CLI cho chắc — cùng một việc, định dạng tường minh:
> `./infra/ecs-fargate/run-oneoff-task.sh migration`
>
> ⚠️ **Đừng dùng `npm run migration:run`** — script đó gọi `typeorm-ts-node-commonjs` trên `src/`,
> mà image production đã `npm prune --production` và không copy `src/` → `ts-node not found`.
> Lệnh ở trên gọi thẳng CLI typeorm trên bản đã build (`typeorm` là dependency runtime nên có sẵn).
> Seed thì `seed:prod` đã đúng sẵn (`node dist/database/seeds/run-seed.js`).

Xem kết quả: **Tasks → chọn task (lọc Desired status = Stopped) → tab Logs**.

---

## Bước 8 — Verify

```bash
ALB=<dns-name-của-alb>
curl http://$ALB/health      # {"status":"ok"}
curl http://$ALB/products    # có data ⇒ gateway → product gRPC → RDS đều OK
```

Đăng ký/đăng nhập lấy JWT ⇒ auth + ElastiCache OK.
`POST /orders` rồi xem **CloudWatch → Log groups → `/ecs/notification-worker`** thấy event
⇒ order → product gRPC + Amazon MQ OK.

---

## Đọc lỗi trong Console khi task chết

**ECS → Clusters → `ecommerce` → Tasks → đổi filter *Desired status* sang `Stopped`
→ mở task → ô `Stopped reason` ở đầu trang.** Đọc dòng này **trước** khi mò CloudWatch —
phần lớn lỗi Ngày 2 là lỗi hạ tầng, chưa chạm tới code nên log app trống trơn.

| Stopped reason | Nguyên nhân |
|---|---|
| `CannotPullContainerError` | quên bật Public IP (bước 6) |
| `exec format error` | image build trên máy ARM, thiếu `--platform linux/amd64` |
| `ResourceInitializationError: unable to pull secrets` | thiếu inline policy `read-app-secret` ở **execution** role, hoặc ARN secret sai/thiếu `::` |
| `Task failed ELB health checks` | grace period quá ngắn, hoặc health check path không phải `/health` |
| Task RUNNING nhưng gateway trả 504 | `sg-app` thiếu 3 rule gRPC trỏ về chính nó, hoặc quên bật Service discovery |
| Log có `no pg_hba.conf entry ... SSL off` | `DATABASE_URL` trong secret thiếu `?sslmode=no-verify` |
| Log có `ECONNREFUSED` phía RabbitMQ | dùng `amqp://:5672` thay vì `amqps://:5671` |

---

## ✅ Checklist Ngày 2

- [ ] 2 IAM role, execution role **có** inline policy đọc secret
- [ ] Cloud Map namespace `microservice.local`
- [ ] Cluster `ecommerce` (chỉ Fargate)
- [ ] 5 task definition, placeholder đã thay hết
- [ ] Target group type **IP addresses**, health check `/health`
- [ ] ALB internet-facing, listener 80 → target group
- [ ] 5 ECS service RUNNING, **Launch type = FARGATE**, **Public IP on**, service discovery bật
- [ ] Migration chạy xong (3 service), seed xong (2 service)
- [ ] `curl http://<ALB-DNS>/products` ra data

## 💸 Trước khi tắt máy

**ECS → Services → chọn service → Update → Desired tasks = 0** (làm cho cả 5).
Giữ ALB nếu hôm sau còn demo; không thì **EC2 → Load Balancers → Delete** (ALB tính $0.55/ngày
kể cả không có traffic). Task definition và cluster giữ lại — miễn phí.
