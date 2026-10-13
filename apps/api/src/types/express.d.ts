import type { AuthContext } from '../auth/auth.types';

declare global {
  namespace Express {
    interface Request {
      id?: string;
      auth?: AuthContext;
    }
  }
}
export {};
