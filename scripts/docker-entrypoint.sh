#!/bin/sh
set -e
# Apply database migrations, seed users/templates (idempotent), then start.
npx prisma migrate deploy
node dist/seed.js
exec node dist/main.js
