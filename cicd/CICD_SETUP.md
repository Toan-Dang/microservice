# CI/CD Setup — Ngày 6

Bạn dựng **cả hai** route để học và để CV có cả "GitHub Actions" lẫn "AWS CodePipeline/CodeBuild/CodeDeploy".

---

## Route A — GitHub Actions (nhanh, miễn phí cho repo)

Luồng: push `main` → test 5 service (matrix) → build & push image lên ECR (OIDC, không cần access key) → SSH vào EC2 pull & restart.

### Bước làm
1. Copy `cicd/github-actions/ci.yml` và `deploy.yml` vào `.github/workflows/` trong repo.
2. **Tạo IAM role cho GitHub OIDC** (không lưu access key vào GitHub):
   - IAM → Identity providers → Add provider → OpenID Connect
     - Provider URL: `https://token.actions.githubusercontent.com`
     - Audience: `sts.amazonaws.com`
   - Tạo role tin cậy provider này, giới hạn theo repo của bạn (`sub: repo:<user>/<repo>:ref:refs/heads/main`).
   - Gắn quyền: `AmazonEC2ContainerRegistryPowerUser` (push ECR).
3. Thêm **GitHub Secrets** (Settings → Secrets and variables → Actions):
   - `AWS_ROLE_ARN` — ARN role vừa tạo
   - `ECR_REGISTRY` — `<account>.dkr.ecr.<region>.amazonaws.com`
   - `EC2_HOST` — IP public EC2
   - `EC2_USER` — `ec2-user`
   - `EC2_SSH_KEY` — nội dung file `.pem`
4. Push 1 commit lên `main` → xem tab **Actions** chạy.

---

## Route B — AWS CodePipeline (đúng yêu cầu "CI/CD trên AWS")

Luồng: GitHub (source) → **CodeBuild** (`buildspec.yml`: build & push 5 image) → **CodeDeploy** (`appspec.yml`: deploy lên EC2 qua agent).

### Chuẩn bị EC2 cho CodeDeploy
CodeDeploy agent đã được cài trong `infra/ec2-userdata.sh`. Kiểm tra:
```bash
sudo systemctl status codedeploy-agent
```
EC2 cần **tag** để CodeDeploy nhận diện, ví dụ: `Name=ecommerce-prod`.

### Bước làm
1. **IAM roles:**
   - `CodeBuildServiceRole` — quyền ECR push + CloudWatch Logs.
   - `CodeDeployServiceRole` — dùng policy `AWSCodeDeployRole`.
   - **EC2 instance profile** — quyền đọc ECR (`AmazonEC2ContainerRegistryReadOnly`) + S3 read (CodeDeploy artifact).
2. **CodeBuild project:**
   - Source: GitHub repo, branch `main`.
   - Environment: Ubuntu, **Privileged = ON** (cần cho `docker build`).
   - Buildspec: `cicd/aws/buildspec.yml` (đổi path hoặc để ở gốc repo).
3. **CodeDeploy:**
   - Application (platform: EC2/On-premises).
   - Deployment group: chọn EC2 theo tag `Name=ecommerce-prod`, deploy type **In-place**.
4. **CodePipeline:**
   - Stage 1 Source: GitHub (via CodeStar connection).
   - Stage 2 Build: CodeBuild project ở trên.
   - Stage 3 Deploy: CodeDeploy application/deployment group ở trên.
5. Push commit → xem pipeline chạy 3 stage.

### Lưu ý chi phí
- CodePipeline: 1 pipeline **miễn phí/tháng**, sau đó $1/pipeline. Chỉ tạo 1.
- CodeBuild: 100 phút build/tháng miễn phí. Build 5 image nhỏ nằm trong hạn mức nếu không chạy quá thường xuyên.
- Xóa pipeline khi làm xong nếu không cần giữ.

---

## So sánh nhanh (để nói trong phỏng vấn)

| | GitHub Actions | AWS CodePipeline |
|---|---|---|
| Chi phí | Miễn phí (repo) | ~$1/tháng sau free |
| Setup | Nhanh, YAML | Nhiều IAM role hơn |
| Ưu điểm | Ecosystem lớn, dễ | Native AWS, tích hợp sâu, audit |
| Khi nào dùng | Đa số dự án | Team đã all-in AWS, cần kiểm soát/compliance |

> Điểm cộng CV: bạn trình bày được **vì sao** chọn cái nào, không chỉ "biết dùng".
