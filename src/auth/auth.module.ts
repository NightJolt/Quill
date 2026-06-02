import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { App, AppSchema } from './app.schema';
import { AppRepository } from './app.repository';
import { AppRegistry } from './app-registry.service';
import { InternalKeyGuard } from './internal-key.guard';
import { WsSessionGuard } from './ws-session.guard';
import { KeyVault } from './key-vault.service';
import { AdminTokenGuard } from './admin-token.guard';
import { SignatureGuard } from './signature.guard';

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: App.name, schema: AppSchema }])],
  providers: [
    AppRepository,
    KeyVault,
    AppRegistry,
    InternalKeyGuard,
    WsSessionGuard,
    AdminTokenGuard,
    SignatureGuard,
  ],
  exports: [
    KeyVault,
    AppRegistry,
    InternalKeyGuard,
    WsSessionGuard,
    AdminTokenGuard,
    SignatureGuard,
  ],
})
export class AuthModule {}
