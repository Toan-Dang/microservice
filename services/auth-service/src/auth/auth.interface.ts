export interface RegisterRequest {
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

export interface ValidateTokenRequest {
  accessToken: string;
}

export interface ValidateTokenResponse {
  valid: boolean;
  userId: string;
  email: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}
