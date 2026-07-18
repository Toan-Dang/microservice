import { Controller, Get } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { AuthClientService } from './auth-client.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authClientService: AuthClientService) {}

  @Get('ping')
  async ping() {
    const result = await firstValueFrom(this.authClientService.ping());
    return { grpcConnected: true, auth: result };
  }
}
