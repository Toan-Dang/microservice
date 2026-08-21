#!/usr/bin/env bash
#
# lib.sh — helper dùng chung cho các script deploy ECS. Chỉ để `source`, không chạy trực tiếp.
#
# Vì sao cần: ECS service tạo bằng wizard Console bị gắn hậu tố ngẫu nhiên
# (`auth-service` → `auth-service-service-99jdlchp`), trong khi task definition family vẫn là
# `auth-service`. ECS KHÔNG cho đổi tên service, nên thay vì hardcode, tra ngược từ cluster.
# Service tạo bằng infra/ecs-fargate/create-services.sh thì tên đã đúng — nhánh khớp chính xác
# bên dưới lo trường hợp đó, không cần sửa gì thêm.

_ECS_NAMES_CACHE=""

_ecs_all_service_names() {
  if [ -z "$_ECS_NAMES_CACHE" ]; then
    _ECS_NAMES_CACHE=$(aws ecs list-services --cluster "$CLUSTER" --region "$AWS_REGION" \
      --query 'serviceArns[]' --output text | tr '\t' '\n' | sed 's#.*/##' | grep . || true)
  fi
  printf '%s\n' "$_ECS_NAMES_CACHE"
}

# ecs_service_name <tên logic>  → in ra tên ECS service thật. Thoát 1 nếu không suy ra được.
ecs_service_name() {
  local want="$1" all match n
  all=$(_ecs_all_service_names)

  if printf '%s\n' "$all" | grep -qxF "$want"; then echo "$want"; return 0; fi

  match=$(printf '%s\n' "$all" | grep -E "^${want}(-service)?-[A-Za-z0-9]+$" || true)
  n=$(printf '%s' "$match" | grep -c . || true)

  if [ "$n" -eq 1 ]; then echo "$match"; return 0; fi

  # Mơ hồ thì DỪNG, không đoán bừa — deploy nhầm service còn tệ hơn fail.
  if [ "$n" -eq 0 ]; then
    echo "✗ Không tìm thấy ECS service cho '$want' trong cluster '$CLUSTER'." >&2
  else
    echo "✗ '$want' khớp nhiều service cùng lúc, không đoán được:" >&2
    printf '%s\n' "$match" | sed 's/^/    /' >&2
  fi
  echo "  Service đang có trong cluster:" >&2
  printf '%s\n' "$all" | sed 's/^/    /' >&2
  return 1
}

# ecs_service_names <tên logic...>  → in ra các tên thật, cách nhau bởi khoảng trắng.
ecs_service_names() {
  local s out=()
  for s in "$@"; do out+=("$(ecs_service_name "$s")") || return 1; done
  echo "${out[*]}"
}
