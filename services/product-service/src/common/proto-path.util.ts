import { existsSync } from 'fs';
import { join } from 'path';

/**
 * proto/ nằm ở gốc repo (mount hoặc copy vào /app/proto khi chạy trong Docker),
 * nhưng độ sâu __dirname khác nhau giữa dev (ts-node, chạy từ src) và prod
 * (dist được copy phẳng vào /app/dist) nên thử lần lượt các vị trí có thể.
 */
export function getProtoPath(fileName: string): string {
  const candidates = [
    join(__dirname, '..', '..', '..', '..', 'proto', fileName), // dev: src/common -> repo root
    join(__dirname, '..', '..', 'proto', fileName), // prod: dist/common -> /app
    join(process.cwd(), 'proto', fileName), // cwd = /app (prod container)
    join(process.cwd(), '..', '..', 'proto', fileName), // cwd = services/<name> (local, no docker)
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `Không tìm thấy proto file "${fileName}". Đã thử: ${candidates.join(', ')}`,
    );
  }
  return found;
}
