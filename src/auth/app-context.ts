/**
 * Caller identity decoded from auth.
 *
 *  - `AppContext` (internal callers / app backend) carries only `appId`.
 *  - `UserContext` (end users / WS) carries `appId` + `userId`.
 *
 * Guards attach the appropriate shape to the request/socket; controllers and
 * gateways read it back via the param decorators in this directory.
 */
export interface AppContext {
  appId: string;
}

export interface UserContext {
  appId: string;
  userId: string;
}

declare module 'express' {
  interface Request {
    appContext?: AppContext;
  }
}
