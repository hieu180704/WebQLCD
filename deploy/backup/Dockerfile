# Container chạy sao lưu + dọn dữ liệu tạm hằng đêm. Cùng bản PostgreSQL với DB để pg_dump khớp phiên bản.
FROM postgres:18.6-alpine
RUN apk add --no-cache bash gnupg tzdata
COPY scripts/backup/ /opt/webqlcd/backup/
COPY scripts/maintenance/ /opt/webqlcd/maintenance/
COPY deploy/backup/nightly.sh /opt/webqlcd/nightly.sh
RUN chmod +x /opt/webqlcd/backup/*.sh /opt/webqlcd/nightly.sh \
  && mkdir -p /backups && chown postgres:postgres /backups
# Volume mới gắn vào /backups nhận quyền sở hữu của thư mục này.
VOLUME /backups
USER postgres
ENTRYPOINT ["/opt/webqlcd/nightly.sh"]
