import { mkdir, writeFile } from 'node:fs/promises'
import nodemailer from 'nodemailer'
import type { Config } from '../config.js'

export type Mail = { to: string; subject: string; text: string }
export type Mailer = { send(mail: Mail): Promise<void> }

const DEV_OUTBOX = new URL('../../.dev-mail/', import.meta.url)

/** SMTP when configured; otherwise (dev only — config forbids it in production) a git-ignored outbox folder. */
export function createMailer(config: Config): Mailer {
  if (config.SMTP_URL) {
    const transport = nodemailer.createTransport(config.SMTP_URL)
    return {
      async send(mail) {
        await transport.sendMail({ from: config.MAIL_FROM, ...mail })
      },
    }
  }
  return {
    async send(mail) {
      await mkdir(DEV_OUTBOX, { recursive: true })
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
      await writeFile(
        new URL(name, DEV_OUTBOX),
        `To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`,
      )
    },
  }
}
