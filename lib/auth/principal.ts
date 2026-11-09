import type { ApiRole } from "./roles";

/** The authenticated caller. tenantId always comes from the session, never from the client. */
export type Principal = {
  userId: string;
  tenantId: string;
  role: ApiRole;
};
