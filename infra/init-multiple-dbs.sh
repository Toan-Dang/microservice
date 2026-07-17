#!/bin/bash
# Tạo nhiều database trong 1 Postgres container (database-per-service, tiết kiệm chi phí).
# Đọc biến POSTGRES_MULTIPLE_DATABASES (danh sách cách nhau bởi dấu phẩy).
set -e
set -u

function create_database() {
	local db=$1
	echo "  Creating database '$db'"
	psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
		SELECT 'CREATE DATABASE $db'
		WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$db')\gexec
EOSQL
}

if [ -n "${POSTGRES_MULTIPLE_DATABASES:-}" ]; then
	echo "Multiple database creation requested: $POSTGRES_MULTIPLE_DATABASES"
	for db in $(echo "$POSTGRES_MULTIPLE_DATABASES" | tr ',' ' '); do
		create_database "$db"
	done
	echo "Multiple databases created"
fi
