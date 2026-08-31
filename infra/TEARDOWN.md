# Teardown — Xoá sạch AWS an toàn

> Mục tiêu: xoá **toàn bộ** resource tính tiền, **đúng thứ tự**, verify từng bước để không sót ALB/EIP mồ côi.
> Region: **us-east-1**. Xoá AWS **không ảnh hưởng git** — mọi thứ dựng lại được từ repo.

## ⚠️ 4 nguyên tắc (đọc trước khi gõ lệnh)

1. **LB/Ingress xoá TRƯỚC cluster.** Xoá cluster trước → ALB Controller biến mất → ALB **mồ côi**, vẫn tính tiền, không ai dọn.
2. **Cả ECS (bậc 1) LẪN EKS (bậc 2) đang chạy** cùng 5 service — phải dọn cả hai.
3. **Verify sau mỗi bước** (mỗi mục có lệnh kiểm). Không xoá mù.
4. **Biller lớn nhất = stateful 24/7** (RDS / ElastiCache / Amazon MQ) và **ALB / Elastic IP**. Đừng để sót mấy cái này.

Đặt biến cho gọn:
```bash
export R=us-east-1
```

---

## 0. Trước khi xoá

```bash
# a) Chắc chắn code đã an toàn trên remote
git status --porcelain        # phải rỗng
git push                      # nếu còn commit local

# b) (tùy chọn) Merge PR để bản fix nằm trên main — phòng khi dựng lại sau này
#    https://github.com/Toan-Dang/microservice/pull/new/fix/eks-deploy-gaps

# c) (tùy chọn) Giữ lại data RDS? Tạo snapshot trước. Mặc định bên dưới XOÁ LUÔN không snapshot.
# aws rds create-db-snapshot --db-instance-identifier ecommerce-pg \
#   --db-snapshot-identifier ecommerce-pg-final --region $R
```

---

## 1. EKS Ingress — XOÁ ĐẦU TIÊN (để ALB k8s tự dọn)

```bash
aws eks update-kubeconfig --name ecommerce --region $R
kubectl delete ingress --all -n ecommerce
```

**Verify — chờ ALB `k8s-...apigatew` biến mất** (tới khi lệnh dưới không còn in nó, ~2–3 phút):
```bash
aws elbv2 describe-load-balancers --region $R \
  --query "LoadBalancers[?starts_with(LoadBalancerName,'k8s-')].LoadBalancerName" --output text
```
> Nếu ALB k8s vẫn còn sau 5 phút: controller đã chết trước khi dọn xong → xoá tay ở Bước 5b.

---

## 2. ECS (bậc 1) — services → ALB tay → Cloud Map

Tên service ECS có hậu tố ngẫu nhiên → liệt kê động, KHÔNG hardcode:
```bash
# a) scale 0 rồi xoá từng service
for arn in $(aws ecs list-services --cluster ecommerce --region $R --query 'serviceArns[]' --output text); do
  svc=$(basename "$arn")
  echo "→ xoá $svc"
  aws ecs update-service --cluster ecommerce --service "$svc" --desired-count 0 --region $R >/dev/null
  aws ecs delete-service  --cluster ecommerce --service "$svc" --force --region $R >/dev/null
done
```

**Verify** (phải rỗng):
```bash
aws ecs list-services --cluster ecommerce --region $R --query 'serviceArns' --output text
```

```bash
# b) ALB của ECS (ecommerce-alb) tạo TAY ở bậc 1 → không tự dọn, phải xoá tay
ALB_ARN=$(aws elbv2 describe-load-balancers --region $R \
  --query "LoadBalancers[?LoadBalancerName=='ecommerce-alb'].LoadBalancerArn" --output text)
# xoá listener + target group gắn với nó rồi xoá ALB
for tg in $(aws elbv2 describe-target-groups --load-balancer-arn "$ALB_ARN" --region $R \
    --query 'TargetGroups[].TargetGroupArn' --output text 2>/dev/null); do
  aws elbv2 delete-target-group --target-group-arn "$tg" --region $R
done
aws elbv2 delete-load-balancer --load-balancer-arn "$ALB_ARN" --region $R

# c) Cloud Map namespace (service discovery bậc 1)
NS=$(aws servicediscovery list-namespaces --region $R \
  --query "Namespaces[?Name=='microservice.local'].Id" --output text)
# phải xoá hết service trong namespace trước
for s in $(aws servicediscovery list-services --region $R \
    --query 'Services[].Id' --output text); do
  aws servicediscovery delete-service --id "$s" --region $R 2>/dev/null
done
[ -n "$NS" ] && aws servicediscovery delete-namespace --id "$NS" --region $R
```

---

## 3. EKS — nodegroup → cluster

```bash
# a) nodegroup trước (chứa EC2 node)
aws eks delete-nodegroup --cluster-name ecommerce --nodegroup-name ng-1 --region $R
aws eks wait nodegroup-deleted --cluster-name ecommerce --nodegroup-name ng-1 --region $R   # chờ tới khi xong

# b) rồi mới xoá cluster
aws eks delete-cluster --name ecommerce --region $R
aws eks wait cluster-deleted --name ecommerce --region $R
```
> Nếu bạn dựng cluster bằng `eksctl` thì có thể thay cả bước 3 bằng: `eksctl delete cluster --name ecommerce --region $R`
> (nó tự lo nodegroup + CloudFormation stack). Với cluster tạo bằng Console thì dùng 2 lệnh `aws eks` trên.

**Verify:**
```bash
aws eks list-clusters --region $R --query 'clusters' --output text   # không còn 'ecommerce'
```

---

## 4. ECS cluster (sau khi service đã rỗng)

```bash
aws ecs delete-cluster --cluster ecommerce --region $R
aws ecs list-clusters --region $R --query 'clusterArns' --output text   # verify: không còn
```

---

## 5. Stateful managed — BILLER LỚN NHẤT (24/7)

```bash
# a) RDS (mặc định KHÔNG snapshot — bỏ --skip-final-snapshot nếu muốn giữ)
aws rds delete-db-instance --db-instance-identifier ecommerce-pg \
  --skip-final-snapshot --delete-automated-backups --region $R

# b) ElastiCache — đây là REPLICATION GROUP (không xoá node lẻ được)
aws elasticache delete-replication-group --replication-group-id ecommerce-redis \
  --no-retain-primary-cluster --region $R

# c) Amazon MQ
BROKER=$(aws mq list-brokers --region $R \
  --query "BrokerSummaries[?BrokerName=='ecommerce-mq'].BrokerId" --output text)
aws mq delete-broker --broker-id "$BROKER" --region $R
```

**Verify (mỗi cái phải rỗng hoặc trạng thái `deleting`):**
```bash
aws rds describe-db-instances --region $R --query 'DBInstances[].DBInstanceIdentifier' --output text
aws elasticache describe-replication-groups --region $R --query 'ReplicationGroups[].ReplicationGroupId' --output text
aws mq list-brokers --region $R --query 'BrokerSummaries[].BrokerName' --output text
```

---

## 5b. ALB EKS còn sót (chỉ khi Bước 1 không tự dọn)

```bash
aws elbv2 describe-load-balancers --region $R \
  --query "LoadBalancers[?starts_with(LoadBalancerName,'k8s-')].LoadBalancerArn" --output text
# nếu còn ARN → xoá:
# aws elbv2 delete-load-balancer --load-balancer-arn <ARN> --region $R
```

---

## 6. Elastic IP — CẨN THẬN, dễ sót nhưng cũng dễ xoá nhầm

IPv4 public giờ **tính tiền cả khi đang gắn** (~$0.005/h mỗi cái). Sau khi xoá hết ở trên, nhiều EIP sẽ rơi về **không associated** → release.

```bash
# Liệt kê EIP CHƯA associated (an toàn để release). Association còn dính = vẫn đang gắn resource nào đó, ĐỪNG release vội.
aws ec2 describe-addresses --region $R \
  --query 'Addresses[?AssociationId==`null`].[PublicIp,AllocationId]' --output table
```
> 🛑 **Chỉ release EIP đã chắc chắn là của project này và KHÔNG còn associated.** Nếu account còn dùng cho việc khác, đối chiếu tag trước:
> `aws ec2 describe-addresses --region $R --query 'Addresses[].[PublicIp,AllocationId,Tags]'`
```bash
# release từng cái (thay <ALLOC_ID>):
# aws ec2 release-address --allocation-id <ALLOC_ID> --region $R
```

---

## 7. Dọn phần rẻ/free (cho sạch hẳn)

```bash
# ECR — 5 repo (xoá cả image)
for repo in api-gateway auth-service product-service order-service notification-worker; do
  aws ecr delete-repository --repository-name "$repo" --force --region $R 2>/dev/null
done

# Secrets Manager (đặt --force-delete... để xoá ngay, không giữ 7–30 ngày)
for s in $(aws secretsmanager list-secrets --region $R --query 'SecretList[].Name' --output text); do
  aws secretsmanager delete-secret --secret-id "$s" --force-delete-without-recovery --region $R 2>/dev/null
done

# CloudWatch log groups của cluster/app
for lg in $(aws logs describe-log-groups --region $R \
    --query "logGroups[?contains(logGroupName,'ecommerce')].logGroupName" --output text); do
  aws logs delete-log-group --log-group-name "$lg" --region $R
done

# Security group tự tạo (ecommerce-sg-*) — xoá SAU khi mọi ENI đã gỡ (cluster/RDS/MQ đã xoá xong)
# aws ec2 describe-security-groups --region $R --query "SecurityGroups[?starts_with(GroupName,'ecommerce-sg')].[GroupName,GroupId]" --output table
# aws ec2 delete-security-group --group-id <SG_ID> --region $R
```
> SG chỉ xoá được khi không còn ENI nào tham chiếu → làm cuối cùng, sau khi RDS/MQ/cluster đã biến mất hẳn (có thể phải chờ vài phút).

---

## 8. ✅ Quét cuối — tất cả phải RỖNG

```bash
R=us-east-1
echo "EKS:";        aws eks list-clusters --region $R --query 'clusters' --output text
echo "ECS:";        aws ecs list-clusters --region $R --query 'clusterArns' --output text
echo "RDS:";        aws rds describe-db-instances --region $R --query 'DBInstances[].DBInstanceIdentifier' --output text
echo "ElastiCache:";aws elasticache describe-replication-groups --region $R --query 'ReplicationGroups[].ReplicationGroupId' --output text
echo "Amazon MQ:";  aws mq list-brokers --region $R --query 'BrokerSummaries[].BrokerName' --output text
echo "ALB:";        aws elbv2 describe-load-balancers --region $R --query 'LoadBalancers[].LoadBalancerName' --output text
echo "EIP (chưa gắn):"; aws ec2 describe-addresses --region $R --query 'Addresses[?AssociationId==`null`].PublicIp' --output text
```
Tất cả in ra rỗng (hoặc chỉ còn cái đang `deleting`) ⇒ **đã sạch, hết tính tiền.**

> Cuối cùng: mở **AWS Billing → Cost Explorer** 1–2 ngày sau để chắc chi phí về ~$0.
> Đặt **AWS Budgets alert $1** để được cảnh báo nếu còn resource lén tính tiền.

---

## 💸 Vì sao phải làm gấp
Đang chạy song song **EKS + ECS + RDS + ElastiCache + Amazon MQ + 2 ALB + 8 EIP** ≈ **$10–14/ngày**.
Khi hết free-tier/credit, đây là hoá đơn thật. Teardown đúng thứ tự trên là cách chắc chắn nhất để về $0.
