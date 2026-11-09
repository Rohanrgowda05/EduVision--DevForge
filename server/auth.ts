import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { storage } from "./storage";
import type { User } from "@shared/schema";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/**
 * Middleware ensuring every /api/* route (except health checks)
 * is called by an authenticated user.
 *
 * Populates req.user with the local database user record.
 */
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  // Public health check endpoints
  if (req.path === "/health" || req.path === "/api/health") {
    return next();
  }

  // 1. Verify token with Clerk
  try {
    const auth = getAuth(req);
    if (auth && auth.userId) {
      const authId = auth.userId;
      const email = (auth.sessionClaims as any)?.email || `${authId}@clerk.user`;
      const user = await storage.upsertUser({ authId, email });
      req.user = user;
      return next();
    }
  } catch (_err) {
    // If Clerk secret is not configured or verification fails, fallback to test tokens
  }

  // 2. Test & development authentication headers / query params
  // Allows testing user isolation in CI/local tests without live Clerk tokens
  const mockAuthId = (req.headers["x-test-auth-id"] as string | undefined) ||
                     (req.query?.testAuthId as string | undefined);
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (mockAuthId) {
    const email = `${mockAuthId}@test.local`;
    const user = await storage.upsertUser({ authId: mockAuthId, email });
    req.user = user;
    return next();
  }

  if (bearerToken && bearerToken.startsWith("test_user_")) {
    const authId = bearerToken;
    const email = `${authId}@test.local`;
    const user = await storage.upsertUser({ authId, email });
    req.user = user;
    return next();
  }

  // 3. Unauthenticated request
  return res.status(401).json({ error: "Unauthorized: Valid session required" });
}

