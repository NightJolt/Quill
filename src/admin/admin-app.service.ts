import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { AppRegistry } from '@/auth/app-registry.service';
import { ConnectionRegistry } from '@/ws/connection-registry.service';
import { AppRes, RegisterAppRes, RotateKeyRes } from './admin.dto';

/**
 * Orchestrates admin-level app lifecycle. Wraps `AppRegistry` mutations
 * with the cross-service side effects they imply (socket invalidation on
 * key change / revoke) so the controller can be pure delegation.
 *
 * `AppRegistry` owns the registry-internal invariants (key generation,
 * encryption, cache, not-found errors). This service owns the use case
 * orchestration ("rotating must also disconnect live sessions").
 */
@Injectable()
export class AdminAppService {
  constructor(
    private readonly registry: AppRegistry,
    private readonly connections: ConnectionRegistry,
  ) {}

  async list(): Promise<AppRes[]> {
    const apps = await this.registry.list();
    return apps.map((a) => plainToInstance(AppRes, a));
  }

  async register(label: string): Promise<RegisterAppRes> {
    return plainToInstance(RegisterAppRes, await this.registry.register(label));
  }

  async rotate(appId: string): Promise<RotateKeyRes> {
    const result = await this.registry.rotate(appId);
    // Old signatures stop verifying immediately; kick open sockets so
    // clients reconnect under the fresh key.
    this.connections.disconnectAllForApp(appId);
    return plainToInstance(RotateKeyRes, result);
  }

  async unregister(appId: string): Promise<void> {
    await this.registry.unregister(appId);
    this.connections.disconnectAllForApp(appId);
  }
}
