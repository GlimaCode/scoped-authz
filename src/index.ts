export { authorizeScope, authorizeScopes, governableScopes } from "./authorize.js";
export { Guard } from "./guard.js";
export { RevocationChecker } from "./revocation.js";
export { DEFAULT_MAX_ENTRIES, DEFAULT_TTL_MS, ScopeResolver } from "./scopeResolver.js";
export { TtlCache } from "./ttlCache.js";
export { ALLOW, NO_SCOPE, deny } from "./types.js";
export type {
  Actor,
  Clock,
  Decision,
  Denial,
  RevocationStore,
  Role,
  Scope,
  ScopeStore,
} from "./types.js";
