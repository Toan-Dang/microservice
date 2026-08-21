# Console Guide — CI/CD (Ngày 3 cho ECS · Ngày 10 cho EKS)

> **Bản bấm chuột.** File pipeline tương ứng: [`github-actions/`](./github-actions/),
> [`aws/buildspec.yml`](./aws/buildspec.yml). Tổng quan & so sánh: [`README.md`](./README.md).

> **Trạng thái đối chiếu (18/08/2026).**
> ✅ Wizard CodePipeline (7 bước, `Choose creation option`) — **đã đối chiếu** với docs AWS và đã sửa lại.
> ⚠️ IAM identity provider / role Web identity, CodeBuild project, CodeConnections — chưa đối chiếu lại lần này.

Có 2 route. **Route A dùng ít Console hơn nhưng ít bước hơn hẳn** — làm A trước, làm B nếu muốn
CV có thêm dòng "AWS CodePipeline".

---

# Route A — GitHub Actions (khuyến nghị)

Phần Console ở đây chỉ là **tạo IAM role cho GitHub** — làm 1 lần, dùng cho cả 2 bậc.

## A1. Identity provider

**Console → IAM → Identity providers → Add provider**

| Trường | Giá trị |
|---|---|
| Provider type | **OpenID Connect** |
| Provider URL | `https://token.actions.githubusercontent.com` → bấm **Get thumbprint** |
| Audience | `sts.amazonaws.com` |

> OIDC nghĩa là GitHub tự chứng minh danh tính với AWS bằng token ngắn hạn.
> **Không có access key nào nằm trong GitHub Secrets** — mất repo cũng không mất tài khoản AWS.
> Đây là cách làm đúng hiện nay; hướng dẫn cũ trên mạng còn bảo lưu `AWS_ACCESS_KEY_ID` — đừng.

## A2. Role `GitHubActionsDeployRole`

**IAM → Roles → Create role**

| Trường | Chọn |
|---|---|
| Trusted entity type | **Web identity** |
| Identity provider | `token.actions.githubusercontent.com` |
| Audience | `sts.amazonaws.com` |
| GitHub organization / repository / branch | user của bạn / **tên repo** / `main` |

> ⚠️ Ô **repository** chỉ điền **tên repo** (`microservice`), KHÔNG dán URL
> `https://github.com/<user>/<repo>`. Dán URL thì AWS ghép thành
> `repo:<user>/https://github.com/<user>/<repo>:ref:...` và mọi lần assume đều fail.

Tạo xong → mở role → tab **Trust relationships** → **Edit trust policy**. Wizard sinh ra dạng `sub` cũ:

```json
"StringLike": {
  "token.actions.githubusercontent.com:sub": "repo:<user>/<repo>:ref:refs/heads/main"
}
```

> ⚠️ Nếu chỗ này là `"sub": "*"` hoặc thiếu hẳn điều kiện `sub` thì **bất kỳ repo GitHub nào
> trên thế giới** cũng assume được role của bạn. Đây là lỗi cấu hình OIDC phổ biến nhất.

### ⚠️ Bẫy: immutable identifiers — dạng `sub` mới của GitHub

Repo bật **immutable identifiers** thì token GitHub gửi lên có `sub` chèn thêm database ID của
owner và của repo:

```
repo:<user>@<ownerId>/<repo>@<repoId>:ref:refs/heads/main
```

Dạng này **không khớp** policy wizard sinh ra ở trên → workflow fail với
`Not authorized to perform sts:AssumeRoleWithWebIdentity`, retry 12 lần rồi bỏ cuộc — **dù A1/A2/A3
làm đúng hết**. Đây là lỗi khớp điều kiện, không phải lỗi tạm thời, nên retry vô ích.

Đừng tắt tính năng này ở GitHub — nó chính là thứ chống việc người khác đổi tên / chiếm repo cũ rồi
assume role của bạn. Sửa trust policy cho khớp:

**Lấy `sub` thật.** Thêm workflow tạm (`workflow_dispatch`, `permissions: id-token: write`), chạy tay:

```bash
TOKEN=$(curl -sS -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
  "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=sts.amazonaws.com" | jq -r '.value')
echo "$TOKEN" | cut -d. -f2 | python3 -c \
  'import sys,base64,json; s=sys.stdin.read().strip(); s+="="*(-len(s)%4); print(json.dumps(json.loads(base64.urlsafe_b64decode(s)), indent=2))' \
  | jq '{sub, aud, repository, ref, event_name}'
```

(In claim đã decode, KHÔNG in token. Xoá workflow này sau khi xong.)

**Dán `sub` đó vào policy.** Console → IAM → Roles → role của bạn → **Trust relationships** →
**Edit trust policy** → thay toàn bộ block `Condition`:

```json
"Condition": {
  "StringEquals": {
    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
    "token.actions.githubusercontent.com:sub": [
      "repo:<user>@<ownerId>/<repo>@<repoId>:ref:refs/heads/main",
      "repo:<user>/<repo>:ref:refs/heads/main"
    ]
  }
}
```

→ **Update policy**. Có hiệu lực ngay, chỉ cần **Re-run** job đã fail, không phải push lại.

Ghi chú về policy này:
- Liệt kê **cả 2 dạng** `sub`: dạng ID là dạng đang dùng, dạng cũ để phòng khi setting đổi. Cả hai
  đều khớp tuyệt đối nên không nới rộng quyền.
- `StringLike` → `StringEquals`: hết wildcard rồi thì `StringLike` chỉ gây hiểu nhầm.
- **KHÔNG** viết `repo:<user>@*/<repo>@*:ref:refs/heads/main`. Nó khớp với bất kỳ ai dựng được
  owner/repo trùng tên — đúng bằng việc vứt bỏ cái mà immutable ID đang bảo vệ.
- `sub` gắn cứng `ref:refs/heads/main`. Sau này deploy từ tag, từ PR, hay từ job có
  `environment: production` thì `sub` đổi dạng (vd `:environment:production`) và fail y hệt →
  thêm entry tương ứng vào list, đừng thay bằng `*`.

Permissions → **Add permissions → Attach policies** → `AmazonEC2ContainerRegistryPowerUser`.

Rồi **Create inline policy** → JSON (thay `<ACCOUNT_ID>`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DeployToECS",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition",
        "ecs:UpdateService", "ecs:DescribeServices", "ecs:ListServices"
      ],
      "Resource": "*"
    },
    {
      "Sid": "PassTaskRoles",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": [
        "arn:aws:iam::<ACCOUNT_ID>:role/ecommerceTaskExecutionRole",
        "arn:aws:iam::<ACCOUNT_ID>:role/ecommerceTaskRole"
      ]
    },
    {
      "Sid": "DeployToEKS",
      "Effect": "Allow",
      "Action": "eks:DescribeCluster",
      "Resource": "*"
    }
  ]
}
```

> **`ecs:ListServices` để làm gì:** `deploy/ecs/lib.sh` tra tên ECS service thật từ cluster
> (xem bẫy tên service ở A2b). Thiếu quyền này thì deploy fail với `AccessDeniedException` ngay
> ở bước tra tên, trước cả khi gọi `update-service`.

> **`iam:PassRole` là bẫy kinh điển của bậc 1.** `RegisterTaskDefinition` khai
> `executionRoleArn`/`taskRoleArn` → IAM coi đó là "trao role cho service khác" và đòi quyền này.
> Thiếu là fail với `AccessDeniedException` **không hề nhắc chữ PassRole** ở dòng đầu.

Copy **Role ARN**.

## A2b. Bẫy: tên ECS service ≠ tên task definition

Tạo ECS service bằng **wizard Console** thì AWS tự gắn hậu tố ngẫu nhiên vào tên:

| Task definition family | Tên ECS service Console tạo ra |
|---|---|
| `auth-service` | `auth-service-service-99jdlchp` |
| `api-gateway` | `api-gateway-service-a0rwllrk` |

`deploy-ecs.sh` register task def theo family (chạy được) rồi gọi `update-service --service auth-service`
→ **`ServiceNotFoundException`**. Nhìn log rất dễ tưởng service chưa được tạo, trong khi nó đang chạy
bình thường.

**ECS không cho đổi tên service.** Hai đường:

1. **Để script tự tra tên** (đang dùng). `deploy/ecs/lib.sh` liệt kê service trong cluster rồi khớp
   `^<tên logic>(-service)?-[A-Za-z0-9]+$`. Khớp chính xác được ưu tiên, nên service tạo bằng
   `infra/ecs-fargate/create-services.sh` (tên đã sạch) vẫn chạy y nguyên. Khớp 0 hoặc >1 thì script
   **dừng** chứ không đoán — deploy nhầm service tệ hơn là fail.
2. **Xoá và tạo lại đúng tên** bằng `infra/ecs-fargate/create-services.sh`. Sạch hơn nhưng phải đăng ký
   lại target group của ALB và có downtime.

> Dùng script `infra/ecs-fargate/create-services.sh` ngay từ đầu thì không dính bẫy này —
> nó truyền `--service-name <svc>` nên tên khớp đúng family.

## A3. Bên GitHub

1. Copy 3 file trong `cicd/github-actions/` vào `.github/workflows/` rồi commit.
2. Repo → **Settings → Secrets and variables → Actions → New repository secret**:
   `AWS_ROLE_ARN` = ARN vừa copy. (Chỉ cần đúng 1 secret.)
3. Push 1 commit lên `main` → tab **Actions** xem chạy.

## A4. Riêng bậc 2 — cấp quyền *trong* cluster cho role

Quyền IAM chỉ đủ để `update-kubeconfig`. Muốn `kubectl` làm được gì thì phải khai ở cluster:

**Console → EKS → cluster `ecommerce` → tab Access → Create access entry**

| Trường | Giá trị |
|---|---|
| IAM principal ARN | ARN của `GitHubActionsDeployRole` |
| Type | Standard |

→ Next → **Add policy**: `AmazonEKSEditPolicy`, Access scope **Namespace** → `ecommerce`.

> Thiếu bước này, workflow fail ở `kubectl` với
> `error: You must be logged in to the server (Unauthorized)` — **dù IAM đã đúng hết**.
> Ghi nhớ: **ECS phân quyền một lớp (IAM); EKS phân quyền hai lớp (IAM để vào tới API server,
> rồi RBAC của k8s để làm được gì bên trong).** Đây là câu hỏi phỏng vấn rất hay gặp.

---

# Route B — AWS CodePipeline (native AWS)

Nhiều bước hơn hẳn, nhưng là thứ team "all-in AWS" thật sự dùng.

## B1. Kết nối GitHub

**Console → Developer Tools → Settings → Connections → Create connection**
→ **GitHub** → đặt tên `github-ecommerce` → **Connect to GitHub** → cài GitHub App → chọn repo.

Trạng thái phải là **Available** (không phải `Pending`).

## B2. CodeBuild project

**Console → CodeBuild → Build projects → Create build project**

| Trường | Giá trị |
|---|---|
| Project name | `ecommerce-build` |
| Source provider | **GitHub** → connection `github-ecommerce` → repo → branch `main` |
| Environment image | Managed image, **Ubuntu**, Runtime **Standard**, image mới nhất |
| **Privileged** | **BẬT** ⚠️ (không bật thì `docker build` fail — CodeBuild chạy trong container) |
| Service role | **New service role**, tên `codebuild-ecommerce-role` |
| Buildspec | **Use a buildspec file** → path `cicd/aws/buildspec.yml` |
| Environment variables | `AWS_REGION=us-east-1`, `CLUSTER=ecommerce`, `DEPLOY_TARGET=ecs` |
| Timeout | 30 phút (build 5 image mất ~5–8 phút) |

Sau khi tạo, cấp quyền cho service role: **IAM → Roles → `codebuild-ecommerce-role`**
→ attach `AmazonEC2ContainerRegistryPowerUser`, và thêm inline policy y hệt phần
`DeployToECS` + `PassTaskRoles` (+ `DeployToEKS` nếu định đổi `DEPLOY_TARGET=eks`) ở mục A2.

## B3. CodePipeline

**Console → CodePipeline → Create pipeline**. Wizard hiện có **7 bước**:

| Bước | Trang | Chọn |
|---|---|---|
| 1 | **Choose creation option** | **Build custom pipeline** ⚠️ (không phải template dựng sẵn) |
| 2 | **Choose pipeline settings** | Pipeline name `ecommerce-pipeline`; **Pipeline type V2**; Service role **New service role** |
| 3 | **Add source stage** | Source provider **GitHub (via GitHub App)** → Connection `github-ecommerce` → repo → branch `main`; Output artifact format **CodePipeline default** |
| 4 | **Add build stage** | **Other providers** → Build provider **AWS CodeBuild** → Project name `ecommerce-build` → **Use a buildspec file** |
| 5 | **Add test stage** | **Skip test stage** |
| 6 | **Add deploy stage** | **Skip deploy stage** ⚠️ (xem dưới) |
| 7 | **Review** | **Create pipeline** |

> ⚠️ **Bước 1 là bước mới** so với các hướng dẫn cũ. CodePipeline giờ hỏi trước: dựng pipeline từ
> **static template** (Deployment / Continuous Integration / Automation) hay **Build custom pipeline**.
> Chọn nhầm template là nó sinh ra một CloudFormation stack với cấu trúc khác hẳn hướng dẫn này.

> ⚠️ **Bước 5 (test stage) cũng là bước mà nhiều hướng dẫn cũ không có.** Cứ Skip.

**Vì sao skip Deploy stage:** `buildspec.yml` ở repo này tự deploy trong phase `post_build`
(chỉ đổi vài dòng giữa ECS và EKS). Thêm Deploy stage kiểu "Amazon ECS" nữa là **deploy hai lần**,
và stage đó cần artifact `imagedefinitions.json` mà buildspec này không sinh ra.

> ⚠️ **Nếu nút `Skip deploy stage` không hiện:** tài liệu AWS ghi *"This option does not appear if you
> have already skipped the build or test stage"* — điều kiện mô tả khá mơ hồ (pipeline chỉ cần
> source + build **hoặc** deploy). Ở đây bạn **có** build stage nên thường skip được. Nếu Console vẫn
> bắt chọn deploy provider, cách gọn nhất: chọn **Amazon ECS**, cluster `ecommerce`, service
> `api-gateway`, rồi **sửa buildspec**: bỏ khối `post_build`, và sinh artifact
> `imagedefinitions.json` dạng `[{"name":"api-gateway","imageUri":"<uri>"}]`.
> Lưu ý cách đó chỉ deploy được **1 container mỗi stage** → 5 service = 5 Deploy stage. Đó chính là
> lý do hướng dẫn này để buildspec tự lo, và cũng là một điểm khác biệt đáng nói khi phỏng vấn:
> **CodePipeline deploy ECS theo từng service, còn script thì lặp qua cả 5.**

Push 1 commit → **CodePipeline → pipeline → xem 2 stage chạy**. Lỗi thì bấm **Details** ở stage
Build để mở log CodeBuild.

## B4. Chi phí

- CodePipeline V2: tính theo **action execution minutes**; V1 là $1/pipeline hoạt động/tháng.
- CodeBuild: tính theo phút build (`general1.small` rẻ nhất).
- Với tài khoản Free-plan kiểu credit, **mọi phút build trừ thẳng vào $190**.
- Xong việc thì **xoá pipeline** (Console → Pipeline → Delete), giữ CodeBuild project cũng được.

---

## Lỗi hay gặp

| Triệu chứng | Chỗ sửa |
|---|---|
| GH Actions: `Not authorized to perform sts:AssumeRoleWithWebIdentity` | Trust policy sai `sub` (A2), hoặc branch khác `main` |
| GH Actions: `AccessDeniedException` khi register task def | thiếu `iam:PassRole` (A2) |
| GH Actions: `You must be logged in to the server (Unauthorized)` | thiếu EKS access entry (A4) |
| CodeBuild: `Cannot connect to the Docker daemon` | quên bật **Privileged** (B2) |
| CodeBuild: `denied: not authorized` khi push ECR | service role thiếu quyền ECR (B2) |
| Pipeline xanh nhưng service vẫn chạy code cũ | deploy dùng tag `latest` → manifest không đổi nên không kích hoạt gì. Deploy theo **git SHA** |
| Pipeline xanh nhưng app crash-loop | thiếu bước chờ (`ecs wait services-stable` / `kubectl rollout status`) |
| Wizard CodePipeline không giống hướng dẫn | chọn nhầm **static template** ở Bước 1 thay vì **Build custom pipeline** |

## ✅ Checklist

- [ ] OIDC provider + role có điều kiện `sub` giới hạn đúng repo/branch
- [ ] Role có: ECR push + ECS deploy + **`iam:PassRole`** cho 2 task role
- [ ] GitHub Secret `AWS_ROLE_ARN`
- [ ] 3 workflow nằm trong `.github/workflows/`
- [ ] Push thử 1 commit → image mới trên ECR, service chạy revision mới
- [ ] (bậc 2) EKS access entry cho role, scope namespace `ecommerce`
