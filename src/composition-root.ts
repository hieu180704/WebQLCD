// Nơi duy nhất ghép implementation vào use case (architecture-spec mục 2.3).
import "server-only";
import { SignIn } from "@/modules/identity/application/sign-in";
import { SignOut } from "@/modules/identity/application/sign-out";
import { BetterAuthAuthenticator } from "@/modules/identity/infrastructure/better-auth-authenticator";

// Lớp presentation không import thẳng shared/infrastructure, nên guard được đưa ra qua đây.
export { requireSession } from "@/shared/infrastructure/auth/guard";

const authenticator = new BetterAuthAuthenticator();
export const signIn = new SignIn(authenticator);
export const signOut = new SignOut(authenticator);
