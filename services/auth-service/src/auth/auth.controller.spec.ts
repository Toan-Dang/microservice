import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [AuthService],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('validateToken trả valid=true khi có accessToken', () => {
    const result = controller.validateToken({ accessToken: 'ping' });
    expect(result.valid).toBe(true);
  });

  it('register trả về email đúng như request', () => {
    const result = controller.register({
      email: 'a@b.com',
      password: '12345678',
    });
    expect(result.email).toBe('a@b.com');
    expect(result.accessToken).toBeDefined();
  });
});
