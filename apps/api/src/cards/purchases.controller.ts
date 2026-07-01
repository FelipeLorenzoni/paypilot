import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import type { SafeUser } from "../auth/safe-user";
import { CreatePurchaseDto } from "./dto/create-purchase.dto";
import { type PurchaseResult, PurchasesService } from "./purchases.service";

@Controller("credit-cards/:cardId/purchases")
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Post()
  create(
    @CurrentUser() user: SafeUser,
    @Param("cardId", ParseUUIDPipe) cardId: string,
    @Body() dto: CreatePurchaseDto,
  ): Promise<PurchaseResult> {
    return this.purchases.create(user.id, cardId, dto);
  }
}
