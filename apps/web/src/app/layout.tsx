import type { ReactNode } from "react";
import "./tokens.css";

export const metadata = {
  title: "PayPilot",
  description: "Personal finance automation",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
