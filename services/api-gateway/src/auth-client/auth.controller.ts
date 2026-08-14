import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthClientService } from './auth-client.service';
import { LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';
import { AuthUser, JwtAuthGuard } from './jwt-auth.guard';
import { rpcToHttp } from '../common/rpc-to-http';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authClientService: AuthClientService) {}

  @ApiOperation({ summary: 'Đăng ký tài khoản mới' })
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    try {
      return await this.authClientService.register(dto.email, dto.password);
    } catch (err) {
      throw rpcToHttp(err);
    }
  }

  @ApiOperation({ summary: 'Đăng nhập, trả về access/refresh token' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    try {
      return await this.authClientService.login(dto.email, dto.password);
    } catch (err) {
      throw rpcToHttp(err);
    }
  }

  @ApiOperation({ summary: 'Làm mới access token bằng refresh token' })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto) {
    try {
      return await this.authClientService.refresh(dto.refresh_token);
    } catch (err) {
      throw rpcToHttp(err);
    }
  }

  /** Route được bảo vệ ví dụ: trả về thông tin user lấy từ access token. */
  @ApiOperation({ summary: 'Lấy thông tin user hiện tại từ access token' })
  @ApiBearerAuth()
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request & { user: AuthUser }) {
    return { user: req.user };
  }
}
