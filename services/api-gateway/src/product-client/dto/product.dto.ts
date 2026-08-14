import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ example: 'Áo thun' })
  @IsString()
  @MinLength(1, { message: 'Tên sản phẩm không được để trống' })
  name: string;

  @ApiProperty({ example: 100000, minimum: 0 })
  @IsNumber()
  @Min(0, { message: 'Giá sản phẩm phải >= 0' })
  price: number;

  @ApiProperty({ example: 50, minimum: 0 })
  @IsInt()
  @Min(0, { message: 'Tồn kho phải >= 0' })
  stock: number;
}

export class FindManyQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 10, minimum: 1, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
