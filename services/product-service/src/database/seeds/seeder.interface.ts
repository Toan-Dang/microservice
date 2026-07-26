import { DataSource } from 'typeorm';

/**
 * Một seeder = 1 nhóm dữ liệu mẫu.
 *
 * Bắt buộc IDEMPOTENT: chạy lại nhiều lần không được nhân đôi dữ liệu, vì
 * seeder có thể chạy mỗi lần service boot (SEED_ON_BOOT) hoặc chạy tay
 * nhiều lần bằng `npm run seed`.
 */
export interface Seeder {
  /** Tên ngắn để hiển thị trong log. */
  readonly name: string;

  /**
   * Thực thi seed.
   * @returns mô tả ngắn kết quả để log, vd: "thêm 5, bỏ qua 0".
   */
  run(dataSource: DataSource): Promise<string>;
}
