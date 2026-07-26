import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import dataSource from '../data-source';
import { runSeeders } from './index';

/**
 * Entry cho `npm run seed` — seed thủ công, không cần khởi động service.
 * vd: docker compose exec product-service npm run seed
 */
const logger = new Logger('seed');

async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    await runSeeders(dataSource, (message) => logger.log(message));
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  logger.error('Seed thất bại', error as Error);
  process.exit(1);
});
