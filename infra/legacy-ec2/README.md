# legacy-ec2/ — Hạ tầng phương án cũ (1 EC2 `t3.medium` + docker-compose)

**Không dùng nữa.** `note/next-plan.md` đã pivot sang ECS Fargate (bậc 1) → EKS (bậc 2).

Lý do pivot: budget không còn là ràng buộc ($190/15 ngày), mục tiêu chuyển sang học-để-phỏng-vấn
→ deploy bằng orchestrator (thứ ngành thực sự dùng), không phải `docker-compose` trên 1 EC2
(setup hobby, học được ít).

| File | Vai trò cũ |
|---|---|
| `AWS_SETUP.md` | tạo EC2, ECR, security group, deploy tay |
| `COST_PLAN.md` | tính chi phí cho ap-southeast-1, credit $130, 17 ngày |
| `deploy-to-ec2.sh` | scp config + ssh `compose pull && up -d` |
| `ec2-userdata.sh` | bootstrap: Docker, compose plugin, CodeDeploy agent, swap 2GB |

Phần vẫn còn giá trị để đọc lại:

- `AWS_SETUP.md` §0 — Free Tier đổi từ 15/07/2025 (tài khoản mới nhận credit thay vì 750h/tháng).
  Vẫn đúng, và là lý do `COST_PLAN` mới tính theo credit chứ không theo "free tier".
- `COST_PLAN.md` §2 — bảng RAM từng container. Chính là căn cứ để đặt
  `resources.requests/limits` trong manifest EKS.
- `ec2-userdata.sh` — IMDSv2 (`PUT` lấy token trước khi đọc metadata). Kiến thức EC2 cơ bản
  vẫn hay bị hỏi.

Phiên bản đang dùng: [`../README.md`](../README.md).

> `docker-compose.prod.yml` ở gốc repo vẫn giữ nguyên — nó là cách chạy stack **local** giống prod
> và là chỗ tra cứu env gốc của từng service. Không xoá.
