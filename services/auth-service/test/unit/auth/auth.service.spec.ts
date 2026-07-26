import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { RedisService } from '../../../src/redis/redis.service';
import { AuthService } from '../../../src/auth/auth.service';
import { User } from '../../../src/entities/user.entity';

const JWT_SECRET = 'test-secret';

/** Repo User giả lập bằng Map trong bộ nhớ — đủ cho unit test logic. */
function createUserRepoMock(): Repository<User> {
  const store = new Map<string, User>();
  let seq = 0;
  return {
    findOne: jest.fn(async ({ where }: { where: { email: string } }) => {
      return [...store.values()].find((u) => u.email === where.email) ?? null;
    }),
    create: jest.fn((data: Partial<User>) => ({ ...data }) as User),
    save: jest.fn(async (user: User) => {
      user.id = user.id ?? `user-${++seq}`;
      user.createdAt = user.createdAt ?? new Date();
      store.set(user.id, user);
      return user;
    }),
  } as unknown as Repository<User>;
}

/** RedisService giả lập bằng Map — bỏ qua TTL. */
function createRedisMock(): RedisService {
  const store = new Map<string, string>();
  return {
    setWithTtl: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  } as unknown as RedisService;
}

describe('AuthService', () => {
  let service: AuthService;
  let repo: Repository<User>;
  let redis: RedisService;
  let jwt: JwtService;

  beforeEach(() => {
    repo = createUserRepoMock();
    redis = createRedisMock();
    jwt = new JwtService({ secret: JWT_SECRET });
    const config = {
      get: (_key: string, def?: string) => def,
    } as unknown as ConfigService;
    service = new AuthService(repo, jwt, redis, config);
  });

  describe('register (hash)', () => {
    it('băm mật khẩu bằng bcrypt, KHÔNG lưu plaintext', async () => {
      await service.register('User@Example.com', 'password123');

      const saved = (repo.save as jest.Mock).mock.calls[0][0] as User;
      expect(saved.passwordHash).not.toBe('password123');
      // hash bcrypt so khớp lại được với mật khẩu gốc
      await expect(
        bcrypt.compare('password123', saved.passwordHash),
      ).resolves.toBe(true);
      // email được chuẩn hoá về lowercase
      expect(saved.email).toBe('user@example.com');
    });

    it('trả access_token + refresh_token hợp lệ', async () => {
      const res = await service.register('a@b.com', 'password123');
      expect(res.accessToken).toBeDefined();
      expect(res.refreshToken).toBeDefined();
      expect(res.email).toBe('a@b.com');

      const check = await service.validateToken(res.accessToken);
      expect(check.valid).toBe(true);
      expect(check.email).toBe('a@b.com');
      expect(check.userId).toBe(res.userId);
    });

    it('từ chối email trùng', async () => {
      await service.register('dup@b.com', 'password123');
      await expect(
        service.register('dup@b.com', 'password123'),
      ).rejects.toBeInstanceOf(RpcException);
    });

    it('từ chối mật khẩu quá ngắn', async () => {
      await expect(
        service.register('short@b.com', '123'),
      ).rejects.toBeInstanceOf(RpcException);
    });
  });

  describe('login', () => {
    it('phát token khi đúng credential', async () => {
      await service.register('login@b.com', 'password123');
      const res = await service.login('login@b.com', 'password123');
      expect(res.accessToken).toBeDefined();
      const check = await service.validateToken(res.accessToken);
      expect(check.valid).toBe(true);
    });

    it('từ chối khi sai mật khẩu', async () => {
      await service.register('login2@b.com', 'password123');
      await expect(
        service.login('login2@b.com', 'wrong-password'),
      ).rejects.toBeInstanceOf(RpcException);
    });

    it('từ chối khi email không tồn tại', async () => {
      await expect(
        service.login('nobody@b.com', 'password123'),
      ).rejects.toBeInstanceOf(RpcException);
    });
  });

  describe('validateToken (token)', () => {
    it('trả valid=false với token rác', async () => {
      const res = await service.validateToken('not-a-jwt');
      expect(res.valid).toBe(false);
      expect(res.userId).toBe('');
    });

    it('trả valid=false khi đưa refresh token vào ô access', async () => {
      const reg = await service.register('rt@b.com', 'password123');
      const res = await service.validateToken(reg.refreshToken);
      expect(res.valid).toBe(false);
    });
  });

  describe('refreshToken (token)', () => {
    it('phát cặp token mới khi refresh token khớp Redis', async () => {
      const reg = await service.register('refresh@b.com', 'password123');
      const res = await service.refreshToken(reg.refreshToken);
      expect(res.accessToken).toBeDefined();
      const check = await service.validateToken(res.accessToken);
      expect(check.valid).toBe(true);
      expect(check.email).toBe('refresh@b.com');
    });

    it('từ chối refresh token cũ sau khi đã xoay vòng', async () => {
      const reg = await service.register('rotate@b.com', 'password123');
      await service.refreshToken(reg.refreshToken); // xoay vòng -> ghi đè Redis
      await expect(
        service.refreshToken(reg.refreshToken),
      ).rejects.toBeInstanceOf(RpcException);
    });

    it('từ chối khi đưa access token vào refresh', async () => {
      const reg = await service.register('mix@b.com', 'password123');
      await expect(
        service.refreshToken(reg.accessToken),
      ).rejects.toBeInstanceOf(RpcException);
    });
  });
});
