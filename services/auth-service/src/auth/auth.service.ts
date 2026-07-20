import { status } from '@grpc/grpc-js';
import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { JwtSignOptions } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { RedisService } from '../redis/redis.service';
import { AuthResponse, ValidateTokenResponse } from './auth.interface';
import { User } from './user.entity';

interface JwtPayload {
  sub: string;
  email: string;
  type: 'access' | 'refresh';
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  private readonly accessTtl: string;
  private readonly refreshTtl: string;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.accessTtl = config.get<string>('JWT_EXPIRES_IN', '15m');
    this.refreshTtl = config.get<string>('REFRESH_EXPIRES_IN', '7d');
  }

  async register(email: string, password: string): Promise<AuthResponse> {
    const normalizedEmail = this.normalizeEmail(email);
    this.validateCredentials(normalizedEmail, password);

    const existing = await this.users.findOne({
      where: { email: normalizedEmail },
    });
    if (existing) {
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: 'Email đã được đăng ký',
      });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await this.users.save(
      this.users.create({ email: normalizedEmail, passwordHash }),
    );

    return this.issueTokens(user.id, user.email);
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.users.findOne({
      where: { email: normalizedEmail },
    });

    // So sánh bcrypt kể cả khi không có user để tránh lộ thông tin qua timing,
    // và luôn trả cùng một lỗi cho "sai email" và "sai password".
    const passwordMatches = user
      ? await bcrypt.compare(password, user.passwordHash)
      : false;

    if (!user || !passwordMatches) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Email hoặc mật khẩu không đúng',
      });
    }

    return this.issueTokens(user.id, user.email);
  }

  async validateToken(accessToken: string): Promise<ValidateTokenResponse> {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(accessToken);
      if (payload.type !== 'access') {
        return { valid: false, userId: '', email: '' };
      }
      return { valid: true, userId: payload.sub, email: payload.email };
    } catch {
      return { valid: false, userId: '', email: '' };
    }
  }

  async refreshToken(refreshToken: string): Promise<AuthResponse> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken);
    } catch {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Refresh token không hợp lệ hoặc đã hết hạn',
      });
    }

    if (payload.type !== 'refresh') {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Token không phải refresh token',
      });
    }

    // Refresh token phải khớp bản đang lưu trong Redis (chống dùng lại token cũ
    // đã bị xoay vòng / thu hồi).
    const stored = await this.redis.get(this.refreshKey(payload.sub));
    if (!stored || stored !== refreshToken) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Refresh token đã bị thu hồi',
      });
    }

    // Xoay vòng: phát cặp token mới và ghi đè bản lưu.
    return this.issueTokens(payload.sub, payload.email);
  }

  private normalizeEmail(email: string): string {
    return (email ?? '').trim().toLowerCase();
  }

  private validateCredentials(email: string, password: string) {
    if (!EMAIL_REGEX.test(email)) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Email không hợp lệ',
      });
    }
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự`,
      });
    }
  }

  private async issueTokens(
    userId: string,
    email: string,
  ): Promise<AuthResponse> {
    // jti duy nhất để mỗi lần phát ra một token khác nhau (kể cả trong cùng
    // 1 giây), giúp việc xoay vòng refresh token thực sự vô hiệu bản cũ.
    const accessToken = await this.jwt.signAsync(
      { sub: userId, email, type: 'access', jti: randomUUID() },
      { expiresIn: this.accessTtl } as JwtSignOptions,
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, email, type: 'refresh', jti: randomUUID() },
      { expiresIn: this.refreshTtl } as JwtSignOptions,
    );

    // TTL của bản lưu Redis lấy từ chính exp của refresh token để luôn nhất quán.
    const decoded = this.jwt.decode(refreshToken) as { exp: number };
    const ttlSeconds = decoded.exp - Math.floor(Date.now() / 1000);
    await this.redis.setWithTtl(
      this.refreshKey(userId),
      refreshToken,
      ttlSeconds,
    );

    return { userId, email, accessToken, refreshToken };
  }

  private refreshKey(userId: string): string {
    return `refresh:${userId}`;
  }
}
