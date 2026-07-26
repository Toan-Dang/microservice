import { DataSource } from 'typeorm';
import { User } from '../../../../src/entities/user.entity';
import { UserSeeder } from '../../../../src/database/seeds/user.seeder';

/** DataSource giả lập: chỉ cần getRepository(User) trả repo in-memory. */
function createDataSourceMock(existing: Partial<User>[] = []) {
  const store: Partial<User>[] = [...existing];
  const repo = {
    findOne: jest.fn(
      async ({ where }: { where: { email: string } }) =>
        store.find((u) => u.email === where.email) ?? null,
    ),
    create: jest.fn((data: Partial<User>) => ({ ...data })),
    save: jest.fn(async (row: Partial<User>) => {
      store.push(row);
      return row;
    }),
  };
  return {
    dataSource: { getRepository: () => repo } as unknown as DataSource,
    repo,
    store,
  };
}

describe('UserSeeder', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('tạo user dev với email/password lấy từ env', async () => {
    process.env.SEED_ADMIN_EMAIL = 'Dev@Example.com';
    process.env.SEED_ADMIN_PASSWORD = 'super-secret';
    const { dataSource, store } = createDataSourceMock();

    const result = await new UserSeeder().run(dataSource);

    expect(result).toBe('thêm dev@example.com');
    expect(store).toHaveLength(1);
    // email được normalize lowercase giống AuthService.register
    expect(store[0].email).toBe('dev@example.com');
    // password luôn được hash, không lưu plaintext
    expect(store[0].passwordHash).not.toBe('super-secret');
    expect(store[0].passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('idempotent — email đã tồn tại thì bỏ qua, không ghi đè password', async () => {
    process.env.SEED_ADMIN_EMAIL = 'admin@example.com';
    const { dataSource, repo, store } = createDataSourceMock([
      { email: 'admin@example.com', passwordHash: 'hash-cu' },
    ]);

    const result = await new UserSeeder().run(dataSource);

    expect(result).toBe('bỏ qua admin@example.com (đã tồn tại)');
    expect(repo.save).not.toHaveBeenCalled();
    expect(store[0].passwordHash).toBe('hash-cu');
  });
});
