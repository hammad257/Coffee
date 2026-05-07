import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { parseDurationToMs } from './time.util';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const raw = config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m';
        const seconds = Math.max(
          60,
          Math.floor(parseDurationToMs(raw) / 1000),
        );
        return {
          secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
          signOptions: {
            expiresIn: seconds,
            algorithm: 'HS256' as const,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
