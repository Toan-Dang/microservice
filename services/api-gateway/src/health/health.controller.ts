import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

// Miễn rate-limit: /health là endpoint hạ tầng (load balancer / uptime check
// gọi liên tục), không phải nơi cần chặn bot.
@SkipThrottle()
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
