import type { ReactNode } from "react";
import { env } from "../env";

export default function HomePage(): ReactNode {
  return (
    <main>
      <h1>PayPilot</h1>
      <p>Personal finance automation.</p>
      <p>API base URL: {env.NEXT_PUBLIC_API_BASE_URL}</p>
    </main>
  );
}
