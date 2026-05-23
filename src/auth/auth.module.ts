import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { App, AppSchema } from './app.schema';
import { AppRegistry } from './app-registry.service';
import { InternalKeyGuard } from './internal-key.guard';
import { WsSessionGuard } from './ws-session.guard';
import { KeyVault } from './key-vault.service';
import { AdminTokenGuard } from './admin-token.guard';

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: App.name, schema: AppSchema }])],
  providers: [KeyVault, AppRegistry, InternalKeyGuard, WsSessionGuard, AdminTokenGuard],
  exports: [KeyVault, AppRegistry, InternalKeyGuard, WsSessionGuard, AdminTokenGuard],
})
export class AuthModule {}
