import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Mật khẩu phải có ít nhất 8 ký tự' })
  password: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email: string;

  @IsString()
  @MinLength(1, { message: 'Mật khẩu không được để trống' })
  password: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(1, { message: 'refresh_token không được để trống' })
  refresh_token: string;
}
