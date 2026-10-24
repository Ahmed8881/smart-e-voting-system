import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from './generated/prisma/client.js'

export type Db = PrismaClient

export function createDb(databaseUrl: string): Db {
  const url = new URL(databaseUrl)
  const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    connectionLimit: 10,
    // MySQL 8 caching_sha2_password over a non-TLS socket needs the server's RSA key.
    // shortcut: fine for localhost; use TLS (ssl option) when the DB is on another host.
    allowPublicKeyRetrieval: url.hostname === 'localhost' || url.hostname === '127.0.0.1',
  })
  return new PrismaClient({ adapter })
}
