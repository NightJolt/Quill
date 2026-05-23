import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';

/**
 * In-memory map of `(appId, userId) → Set<Socket>`. Used by the push pipeline
 * to ask "does this user have any live connection?" before fanning out a push
 * notification.
 *
 * Single-instance only. When/if Quill scales to multiple processes, swap
 * this for a Redis-backed implementation behind the same interface — the
 * callers (ChatGateway, future PushService) need not change.
 */
@Injectable()
export class ConnectionRegistry {
  private readonly byUser = new Map<string, Set<Socket>>();

  add(appId: string, userId: string, socket: Socket): void {
    const key = this.key(appId, userId);
    const set = this.byUser.get(key) ?? new Set<Socket>();
    set.add(socket);
    this.byUser.set(key, set);
  }

  remove(appId: string, userId: string, socket: Socket): void {
    const key = this.key(appId, userId);
    const set = this.byUser.get(key);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.byUser.delete(key);
  }

  hasActive(appId: string, userId: string): boolean {
    const set = this.byUser.get(this.key(appId, userId));
    return !!set && set.size > 0;
  }

  socketsFor(appId: string, userId: string): Socket[] {
    const set = this.byUser.get(this.key(appId, userId));
    return set ? [...set] : [];
  }

  /**
   * Disconnect every socket belonging to a given app. Used by admin
   * mutations (revoke / rotate key) so old signatures stop working
   * immediately — clients reconnect and either fail auth (revoke) or
   * fetch a fresh signature (rotate). Returns the number of sockets
   * actually disconnected.
   */
  disconnectAllForApp(appId: string): number {
    const prefix = `${appId}:`;
    let count = 0;
    for (const [key, sockets] of this.byUser.entries()) {
      if (!key.startsWith(prefix)) continue;
      for (const sock of sockets) {
        sock.disconnect(true);
        count++;
      }
      this.byUser.delete(key);
    }
    return count;
  }

  private key(appId: string, userId: string): string {
    return `${appId}:${userId}`;
  }
}
