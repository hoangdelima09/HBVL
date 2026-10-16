import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.decorators';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha.service';
import { CsrfGuard, CsrfService } from './csrf';
import { MfaService } from './mfa.service';
import { AdminMfaRequestsController, MfaRecoveryController } from './mfa-recovery.controller';
import { MfaRecoveryService } from './mfa-recovery.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { MeController } from '../users/me.controller';

@Global()
@Module({
  controllers: [AuthController, MeController, MfaRecoveryController, AdminMfaRequestsController],
  providers: [AuthService, CaptchaService, SessionService, PasswordService, TokenService, MfaService, MfaRecoveryService, CsrfService, CsrfGuard, AuthGuard],
  exports: [AuthService, SessionService, PasswordService, TokenService, MfaService, CsrfService, CsrfGuard, AuthGuard],
})
export class AuthModule {}
