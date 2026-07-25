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
  @IsString()
  @MinLength(1, { message: 'Tên sản phẩm không được để trống' })
  name: string;

  @IsNumber()
  @Min(0, { message: 'Giá sản phẩm phải >= 0' })
  price: number;

  @IsInt()
  @Min(0, { message: 'Tồn kho phải >= 0' })
  stock: number;
}

export class FindManyQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
