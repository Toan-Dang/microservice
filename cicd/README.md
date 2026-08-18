# cicd/ — Pipeline (Day 6, làm ở Ngày 3 cho ECS · Ngày 10 mở rộng sang EKS)

> Vì sao làm CI/CD **sớm**, ngay sau khi ECS chạy: (a) setup còn nóng trong đầu;
> (b) *de-risk* — nếu EKS trượt lịch vẫn còn nguyên câu chuyện deploy + pipeline hoàn chỉnh;
> (c) mọi thay đổi về sau tự deploy, đỡ thao tác tay suốt 12 ngày còn lại.

## Hai đường

- 🖱️ **Bấm Console (học lần đầu)** → [`CONSOLE_GUIDE.md`](./CONSOLE_GUIDE.md)
- ⌨️ **File pipeline sẵn (copy & chạy)** → phần dưới đây

## Cấu trúc

| Route | File | Deploy target |
|---|---|---|
| **GitHub Actions** (chính) | [`github-actions/ci.yml`](./github-actions/ci.yml) | test → build → push ECR (**dùng chung 2 bậc**) |
| | [`github-actions/deploy-ecs.yml`](./github-actions/deploy-ecs.yml) | bậc 1 — ECS Fargate |
| | [`github-actions/deploy-eks.yml`](./github-actions/deploy-eks.yml) | bậc 2 — EKS |
| **AWS native** | [`aws/buildspec.yml`](./aws/buildspec.yml) | CodeBuild, chọn target qua `DEPLOY_TARGET=ecs\|eks` |
| *(cũ, đã pivot)* | [`legacy-ec2/`](./legacy-ec2/) | CodeDeploy + SSH lên 1 EC2. **Không dùng nữa** |

**Phần đắt nhất (test + build + push) dùng chung cho cả 2 bậc.** Chuyển từ ECS sang EKS chỉ đổi
bước cuối: `aws ecs update-service` → `kubectl set image`. Đó chính là điểm để nói khi phỏng vấn.

```
push main
   │
   ├─ test        (matrix 5 service, fail-fast: false)
   ├─ build-push  (matrix 5 service → ECR, tag = git short SHA + latest)
   │
   └─ deploy ─┬─ deploy-ecs.yml  → register task def revision mới → update-service → wait stable
              └─ deploy-eks.yml  → kubectl set image → rollout status
```

## Cài đặt

1. Copy 3 file trong `github-actions/` vào `.github/workflows/`.
2. Tạo **IAM role cho GitHub OIDC** (không lưu access key trong GitHub):
   - IAM → Identity providers → Add provider → OpenID Connect
     - Provider URL `https://token.actions.githubusercontent.com`, Audience `sts.amazonaws.com`
   - Tạo role tin cậy provider đó, **giới hạn theo repo**:
     `"sub": "repo:<user>/<repo>:ref:refs/heads/main"`.
     Bỏ điều kiện `sub` = **bất kỳ repo GitHub nào trên đời** cũng assume được role của bạn.
   - Quyền:

     | Bậc | Policy |
     |---|---|
     | chung | `AmazonEC2ContainerRegistryPowerUser` |
     | bậc 1 | `ecs:DescribeTaskDefinition`, `ecs:RegisterTaskDefinition`, `ecs:UpdateService`, `ecs:DescribeServices` + `iam:PassRole` cho 2 role của task |
     | bậc 2 | `eks:DescribeCluster` |

3. GitHub Secrets → chỉ cần **`AWS_ROLE_ARN`**.
4. Trong `ci.yml`, bật đúng job deploy cho môi trường hiện tại (Ngày 3: `deploy-ecs`; Ngày 10: thêm/đổi `deploy-eks`).

### ⚠️ `iam:PassRole` — bẫy của bậc 1

`RegisterTaskDefinition` khai `executionRoleArn`/`taskRoleArn` → IAM coi đó là "trao role cho service khác"
và đòi `iam:PassRole` trên đúng 2 ARN đó. Thiếu là fail với `AccessDeniedException` **không hề nhắc chữ PassRole**
trong dòng đầu — rất mất thời gian mò.

### ⚠️ Quyền EKS không nằm ở IAM — bẫy của bậc 2

`eks:DescribeCluster` chỉ đủ để `update-kubeconfig` sinh file config. Quyền **trong** cluster là chuyện
riêng của k8s RBAC: phải map IAM role vào cluster, nếu không sẽ nhận
`error: You must be logged in to the server (Unauthorized)`.

```bash
# cách mới (EKS access entries) — nên dùng
aws eks create-access-entry --cluster-name ecommerce --region us-east-1 \
  --principal-arn arn:aws:iam::<ACCOUNT_ID>:role/<GitHubOIDCRole>
aws eks associate-access-policy --cluster-name ecommerce --region us-east-1 \
  --principal-arn arn:aws:iam::<ACCOUNT_ID>:role/<GitHubOIDCRole> \
  --access-scope type=namespace,namespaces=ecommerce \
  --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSEditPolicy

# cách cũ (aws-auth ConfigMap) — vẫn gặp nhiều trong tài liệu/dự án cũ
eksctl create iamidentitymapping --cluster ecommerce --region us-east-1 \
  --arn arn:aws:iam::<ACCOUNT_ID>:role/<GitHubOIDCRole> --group system:masters --username github
```

Đây là điểm khác biệt lớn giữa 2 bậc: **ECS phân quyền hoàn toàn bằng IAM; EKS phân quyền hai lớp
— IAM để vào tới API server, rồi RBAC của k8s để làm được gì bên trong.**

## Nguyên tắc

- **Tag bằng git SHA.** `latest` là tag di động — không biết production đang chạy commit nào, và
  `set image`/`update-service` với cùng tên tag có thể không kích hoạt deploy vì manifest không đổi.
- **Chờ ổn định rồi mới báo xanh.** `aws ecs wait services-stable` / `kubectl rollout status`.
  Thiếu bước này thì pipeline xanh trong khi service đang crash-loop.
- **Migration KHÔNG chạy tự động trong pipeline.** Chạy tay bằng one-off task / Job:
  `infra/ecs-fargate/run-oneoff-task.sh` hoặc `infra/eks/manifests/40-migration-job.yaml`.
  Migration tự động cần chiến lược backward-compatible (expand/contract) — chưa có ở phase này,
  và một migration hỏng lúc 2h sáng thì không có ai rollback.

## GitHub Actions vs AWS CodeBuild — nói gì khi phỏng vấn

| | GitHub Actions | CodeBuild/CodePipeline |
|---|---|---|
| Chi phí | Miễn phí cho repo public/nhỏ | ~$1/pipeline-tháng + phút build |
| Setup | 1 IAM role + YAML | Nhiều IAM role hơn, source connection |
| Ưu | Ecosystem lớn, log dễ đọc, chạy PR check | Native AWS, không cần OIDC ra ngoài, audit qua CloudTrail |
| Khi nào | Đa số dự án | Team all-in AWS, yêu cầu compliance/network cô lập |

Điểm cộng CV là trình bày được **vì sao chọn**, không phải "biết dùng cả hai".

## Chi phí

- GitHub Actions: miễn phí trong hạn mức repo.
- CodeBuild: tính theo phút build; build 5 image ~5–8 phút/lần.
- Với tài khoản Free-plan kiểu credit, **mọi phút build đều trừ vào $190** — xem
  [`../infra/common/COST_PLAN.md`](../infra/common/COST_PLAN.md).

> Vòng đời dịch vụ (08/2026): CodeBuild / CodePipeline / CodeDeploy vẫn được AWS phát triển bình thường.
> Đừng nhầm với **CodeCatalyst** (đóng với khách mới từ 07/11/2025) và **AWS Proton**
> (ngừng hỗ trợ 07/10/2026). CodeCommit từng đóng với khách mới (07/2024) nhưng **mở lại từ 11/2025**;
> repo này dùng GitHub làm source nên không ảnh hưởng.
