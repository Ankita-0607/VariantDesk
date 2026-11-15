import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export type AppRole = 'ADMIN' | 'ANALYST' | 'LAB_DIRECTOR';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: AppRole;
}

export const ROLES_KEY = 'roles';
export const PUBLIC_KEY = 'public';

/** Restrict an endpoint to roles. ADMIN always passes (all privileges). */
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
