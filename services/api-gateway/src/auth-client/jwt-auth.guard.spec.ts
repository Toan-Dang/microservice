import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthClientService } from './auth-client.service';
import { JwtAuthGuard } from './jwt-auth.guard';

function contextWith(headers: Record<string, string>): {
  ctx: ExecutionContext;
  request: { headers: Record<string, string>; user?: unknown };
} {
  const request: { headers: Record<string, string>; user?: unknown } = {
    headers,
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let authClient: { validateToken: jest.Mock };

  beforeEach(() => {
    authClient = { validateToken: jest.fn() };
    guard = new JwtAuthGuard(authClient as unknown as AuthClientService);
  });

  it('cho qua và gắn req.user khi token hợp lệ', async () => {
    authClient.validateToken.mockResolvedValue({
      valid: true,
      userId: 'u1',
      email: 'a@b.com',
    });
    const { ctx, request } = contextWith({ authorization: 'Bearer good' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(authClient.validateToken).toHaveBeenCalledWith('good');
    expect(request.user).toEqual({ userId: 'u1', email: 'a@b.com' });
  });

  it('chặn (401) khi thiếu header Authorization', async () => {
    const { ctx } = contextWith({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(authClient.validateToken).not.toHaveBeenCalled();
  });

  it('chặn (401) khi token không hợp lệ', async () => {
    authClient.validateToken.mockResolvedValue({
      valid: false,
      userId: '',
      email: '',
    });
    const { ctx } = contextWith({ authorization: 'Bearer bad' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
