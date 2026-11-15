import { Body, Controller, Get, Post, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Public } from './roles';

const LoginDto = z.object({ email: z.string().email(), password: z.string().min(1) });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Post('login')
  async login(@Body(new ZodPipe(LoginDto)) body: z.infer<typeof LoginDto>) {
    const user = await this.prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user || !user.active || !(await bcrypt.compare(body.password, user.passwordHash))) {
      await this.audit.record({ action: 'auth.login_failed', entityType: 'User', after: { email: body.email } });
      throw new UnauthorizedException('Invalid credentials');
    }
    const token = await this.jwt.signAsync({ sub: user.id, role: user.role });
    await this.audit.record({
      actor: { id: user.id, email: user.email, name: user.name, role: user.role },
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
    });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
