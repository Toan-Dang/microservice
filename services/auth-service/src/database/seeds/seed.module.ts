import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { runSeeders } from './index';

/**
 * Chạy seed lúc service boot, CHỈ khi `SEED_ON_BOOT=true` (docker-compose dev
 * bật; prod không set nên không seed). Muốn chạy tay: `npm run seed`.
 *
 * Vì sao dùng OnApplicationBootstrap chứ không phải constructor / OnModuleInit:
 * hook này chạy sau khi mọi module đã init — tức sau khi `migrationsRun: true`
 * tạo xong bảng — nên seed chắc chắn có bảng để ghi vào.
 *
 * DataSource và ConfigService inject được ở đây vì TypeOrmModule.forRootAsync
 * và ConfigModule.forRoot({ isGlobal: true }) ở AppModule đều là global.
 */
@Module({})
export class SeedModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedModule.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('SEED_ON_BOOT') !== 'true') {
      return;
    }

    // Seed chỉ là tiện ích cho dev — lỗi seed không nên làm sập service,
    // chỉ log error để còn thấy được nguyên nhân.
    try {
      await runSeeders(this.dataSource, (message) => this.logger.log(message));
    } catch (error) {
      this.logger.error('Seed thất bại', error as Error);
    }
  }
}
