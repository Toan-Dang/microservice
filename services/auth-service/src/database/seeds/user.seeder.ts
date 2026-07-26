import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { User } from '../../entities/user.entity';
import { Seeder } from './seeder.interface';

// Giữ khớp AuthService.SALT_ROUNDS để hash seed đọc được như user đăng ký thường.
const SALT_ROUNDS = 10;

// Chỉ là default cho DEV (giống JWT_SECRET dev-secret-change-me). Muốn đổi thì
// set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD trong env.
const DEFAULT_EMAIL = 'admin@example.com';
const DEFAULT_PASSWORD = 'admin12345';

/**
 * 1 user dev để thử `POST /auth/login` ngay sau khi dựng DB, không cần register.
 * Idempotent theo email — email đã có thì bỏ qua, KHÔNG ghi đè password.
 */
export class UserSeeder implements Seeder {
  readonly name = 'users';

  async run(dataSource: DataSource): Promise<string> {
    const email = (process.env.SEED_ADMIN_EMAIL ?? DEFAULT_EMAIL)
      .trim()
      .toLowerCase();
    const password = process.env.SEED_ADMIN_PASSWORD ?? DEFAULT_PASSWORD;

    const repo = dataSource.getRepository(User);
    const existing = await repo.findOne({ where: { email } });
    if (existing) {
      return `bỏ qua ${email} (đã tồn tại)`;
    }

    await repo.save(
      repo.create({
        email,
        passwordHash: await bcrypt.hash(password, SALT_ROUNDS),
      }),
    );
    return `thêm ${email}`;
  }
}
