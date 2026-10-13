import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.decorators';
import { AuthService } from './auth.service';
import { CsrfGuard, CsrfService } from './csrf';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { MeController } from '../users/me.controller';

@Global()
@Module({
  controllers: [AuthController, MeController],
  providers: [AuthService, SessionService, PasswordService, TokenService, MfaService, CsrfService, CsrfGuard, AuthGuard],
  exports: [AuthService, SessionService, PasswordService, TokenService, MfaService, CsrfService, CsrfGuard, AuthGuard],
})
export class AuthModule {}
