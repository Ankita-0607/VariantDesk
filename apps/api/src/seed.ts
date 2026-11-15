/**
 * Seeds users from SEED_USERS (phase 1 has no user-management UI) and a default report template.
 * Safe to run repeatedly: existing users keep their passwords unless SEED_RESET_PASSWORDS=1.
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { DEFAULT_SECTIONS, DEFAULT_THEME } from './reports/template.defaults';

async function main() {
  const prisma = new PrismaClient();
  const spec = process.env.SEED_USERS ?? '';
  for (const entry of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [email, role, password] = entry.split(':');
    if (!email || !role || !password || !(role in Role)) {
      console.warn(`Skipping invalid SEED_USERS entry "${entry}" (expected email:ROLE:password)`);
      continue;
    }
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const name = email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    if (!existing) {
      await prisma.user.create({ data: { email: email.toLowerCase(), name, role: role as Role, passwordHash: await bcrypt.hash(password, 12) } });
      console.log(`Created ${role} ${email}`);
    } else if (process.env.SEED_RESET_PASSWORDS === '1') {
      await prisma.user.update({ where: { id: existing.id }, data: { role: role as Role, passwordHash: await bcrypt.hash(password, 12) } });
      console.log(`Reset ${email}`);
    }
  }
  if (!(await prisma.reportTemplate.count())) {
    await prisma.reportTemplate.create({ data: { name: 'Default', isDefault: true, theme: DEFAULT_THEME, sections: DEFAULT_SECTIONS } });
    console.log('Created default report template');
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
