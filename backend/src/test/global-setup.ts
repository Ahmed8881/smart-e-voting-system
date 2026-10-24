import { execSync } from 'node:child_process'

/** Brings the test database up to the latest migration. Data is wiped per test by resetDb(). */
export default function setup() {
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
    stdio: 'pipe',
  })
}
