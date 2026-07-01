import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import type { SafeUser } from "../auth/safe-user";
import type { CreditCardResponse } from "./card.mapper";
import {
  type CreditCardList,
  CreditCardsService,
} from "./credit-cards.service";
import { CreateCreditCardDto } from "./dto/create-credit-card.dto";
import { ListCreditCardsQueryDto } from "./dto/list-credit-cards-query.dto";
import { UpdateCreditCardDto } from "./dto/update-credit-card.dto";

@Controller("credit-cards")
export class CreditCardsController {
  constructor(private readonly cards: CreditCardsService) {}

  @Post()
  create(
    @CurrentUser() user: SafeUser,
    @Body() dto: CreateCreditCardDto,
  ): Promise<CreditCardResponse> {
    return this.cards.create(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: SafeUser,
    @Query() query: ListCreditCardsQueryDto,
  ): Promise<CreditCardList> {
    return this.cards.list(user.id, query);
  }

  @Get(":id")
  get(
    @CurrentUser() user: SafeUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<CreditCardResponse> {
    return this.cards.get(user.id, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: SafeUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateCreditCardDto,
  ): Promise<CreditCardResponse> {
    return this.cards.update(user.id, id, dto);
  }

  /** Deactivates the card (isActive=false); generated history is preserved. */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(
    @CurrentUser() user: SafeUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.cards.deactivate(user.id, id);
  }
}
