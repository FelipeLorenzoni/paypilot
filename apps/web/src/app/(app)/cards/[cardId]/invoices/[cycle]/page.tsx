import type { ReactNode } from "react";
import { InvoicePage } from "../../../../../../features/cards/invoice-page";

export default async function Page({
  params,
}: {
  params: Promise<{ cardId: string; cycle: string }>;
}): Promise<ReactNode> {
  const { cardId, cycle } = await params;
  return <InvoicePage cardId={cardId} cycle={cycle} />;
}
