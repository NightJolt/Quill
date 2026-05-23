import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { QuillConfig } from './quill-config';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
  ],
  providers: [QuillConfig],
  exports: [QuillConfig],
})
export class QuillConfigModule {}
