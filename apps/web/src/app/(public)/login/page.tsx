import { Suspense, type ReactNode } from "react";
import { LoginPage } from "../../../features/auth/login-page";

// Suspense: LoginPage reads useSearchParams (the post-register prompt).
export default function Page(): ReactNode {
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  );
}
