import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth-client/jwt-auth.guard';
import { rpcToHttp } from '../common/rpc-to-http';
import { CreateProductDto, FindManyQueryDto } from './dto/product.dto';
import { ProductClientService } from './product-client.service';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;

@ApiTags('products')
@Controller('products')
export class ProductController {
  constructor(private readonly productClientService: ProductClientService) {}

  @ApiOperation({ summary: 'Danh sách sản phẩm (phân trang)' })
  @Get()
  async list(@Query() query: FindManyQueryDto) {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    try {
      const res = await this.productClientService.findMany(page, limit);
      return {
        data: res.products ?? [],
        total: res.total ?? 0,
        page,
        limit,
      };
    } catch (err) {
      throw rpcToHttp(err);
    }
  }

  @ApiOperation({ summary: 'Chi tiết 1 sản phẩm theo ID' })
  @Get(':id')
  async getOne(@Param('id') id: string) {
    try {
      return await this.productClientService.findOne(id);
    } catch (err) {
      throw rpcToHttp(err);
    }
  }

  @ApiOperation({ summary: 'Tạo sản phẩm mới' })
  @ApiBearerAuth()
  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreateProductDto) {
    try {
      return await this.productClientService.create(
        dto.name,
        dto.price,
        dto.stock,
      );
    } catch (err) {
      throw rpcToHttp(err);
    }
  }
}
