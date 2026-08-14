import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthUser, JwtAuthGuard } from '../auth-client/jwt-auth.guard';
import { rpcToHttp } from '../common/rpc-to-http';
import { CreateOrderDto } from './dto/order.dto';
import { OrderClientService } from './order-client.service';

/**
 * Route đơn hàng — MỌI route cần JWT. userId & email lấy từ token (req.user),
 * KHÔNG nhận từ client để tránh giả mạo.
 */
@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrderController {
  constructor(private readonly orderClientService: OrderClientService) {}

  @ApiOperation({ summary: 'Tạo đơn hàng mới cho user hiện tại' })
  @Post()
  async create(
    @Req() req: Request & { user: AuthUser },
    @Body() dto: CreateOrderDto,
  ) {
    try {
      return await this.orderClientService.createOrder(
        req.user.userId,
        req.user.email,
        dto.items,
      );
    } catch (err) {
      throw rpcToHttp(err);
    }
  }

  @ApiOperation({ summary: 'Danh sách đơn hàng của user hiện tại' })
  @Get()
  async listMine(@Req() req: Request & { user: AuthUser }) {
    try {
      const res = await this.orderClientService.findByUser(req.user.userId);
      return { data: res.orders ?? [] };
    } catch (err) {
      throw rpcToHttp(err);
    }
  }
}
