#!/bin/bash
# Runs once, on first start of an empty MySQL volume.
# Creates the test database and lets the app user run `prisma migrate dev` (it needs a shadow DB).
set -euo pipefail
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}_test\` CHARACTER SET utf8mb4;
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}_test\`.* TO '${MYSQL_USER}'@'%';
GRANT ALL PRIVILEGES ON \`prisma\_migrate\_shadow\_db%\`.* TO '${MYSQL_USER}'@'%';
GRANT CREATE, DROP ON *.* TO '${MYSQL_USER}'@'%';
SQL
