#!/usr/bin/env bash
# Create this app's databases and user on the local MariaDB. Safe to re-run.
#
# Only touches seo_command_center and seo_command_center_test. The password is
# generated once, written to .env (mode 600) and never printed. Re-running keeps it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
DB_MAIN="seo_command_center"
DB_TEST="seo_command_center_test"
DB_USER="seo_app"

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

password="$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
if [ -z "$password" ]; then
  # Letters and digits only, so it needs no escaping in SQL or in a URL.
  password="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40 || true)"
  {
    echo "DB_HOST=127.0.0.1"
    echo "DB_PORT=3306"
    echo "DB_USER=$DB_USER"
    echo "DB_PASSWORD=$password"
    echo "DB_NAME=$DB_MAIN"
    echo "DB_NAME_TEST=$DB_TEST"
  } >>"$ENV_FILE"
fi

# Sent on stdin so the password never shows in a process list.
mariadb --batch <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_MAIN\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS \`$DB_TEST\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$password';
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$password';
ALTER USER '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$password';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$password';
GRANT ALL PRIVILEGES ON \`$DB_MAIN\`.* TO '$DB_USER'@'127.0.0.1';
GRANT ALL PRIVILEGES ON \`$DB_MAIN\`.* TO '$DB_USER'@'localhost';
GRANT ALL PRIVILEGES ON \`$DB_TEST\`.* TO '$DB_USER'@'127.0.0.1';
GRANT ALL PRIVILEGES ON \`$DB_TEST\`.* TO '$DB_USER'@'localhost';
FLUSH PRIVILEGES;
SQL

echo "Databases $DB_MAIN and $DB_TEST are ready. User $DB_USER can reach only those two."
