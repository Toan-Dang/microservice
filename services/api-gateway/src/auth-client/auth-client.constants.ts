export const AUTH_PACKAGE_NAME = 'auth';
export const AUTH_SERVICE_NAME = 'AuthService';
export const AUTH_CLIENT = 'AUTH_CLIENT';

export interface AuthGrpcService {
  register(data: {
    email: string;
    password: string;
  }): import('rxjs').Observable<AuthResponse>;
  login(data: {
    email: string;
    password: string;
  }): import('rxjs').Observable<AuthResponse>;
  validateToken(data: {
    accessToken: string;
  }): import('rxjs').Observable<ValidateTokenResponse>;
  refreshToken(data: {
    refreshToken: string;
  }): import('rxjs').Observable<AuthResponse>;
}

export interface AuthResponse {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

export interface ValidateTokenResponse {
  valid: boolean;
  userId: string;
  email: string;
}
