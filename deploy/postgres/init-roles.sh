#!/bin/sh
# Chạy một lần khi volume DB còn trống (docker-entrypoint-initdb.d). Tách role (data-model mục 5):
# webqlcd_owner sở hữu DB, chạy migration và backup; webqlcd_app là role runtime, quyền cấp ở scripts/migrate.mjs.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$OWNER_DB_PASSWORD" -v app_pw="$APP_DB_PASSWORD" <<'EOF'
CREATE ROLE webqlcd_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE webqlcd_app LOGIN PASSWORD :'app_pw';
CREATE DATABASE webqlcd OWNER webqlcd_owner;
REVOKE ALL ON DATABASE webqlcd FROM PUBLIC;
GRANT CONNECT ON DATABASE webqlcd TO webqlcd_app;
EOF
