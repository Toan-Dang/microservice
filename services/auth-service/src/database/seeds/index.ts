import { DataSource } from 'typeorm';
import { UserSeeder } from './user.seeder';
import { Seeder } from './seeder.interface';

/** Thứ tự chạy seed của auth-service — thêm seeder mới vào danh sách này. */
export const SEEDERS: Seeder[] = [new UserSeeder()];

/**
 * Chạy lần lượt mọi seeder.
 * `log` được truyền vào để caller tự chọn Logger của Nest (khi boot) hay
 * console (khi chạy CLI) — seeds không phụ thuộc vào Nest.
 */
export async function runSeeders(
  dataSource: DataSource,
  log: (message: string) => void,
): Promise<void> {
  for (const seeder of SEEDERS) {
    const result = await seeder.run(dataSource);
    log(`seed "${seeder.name}": ${result}`);
  }
}
