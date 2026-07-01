import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { toAmountBigInt } from "../common/ledger-money-date";
import { type CreditCardResponse, toCreditCardResponse } from "./card.mapper";
import {
  CreditCardsRepository,
  type UpdateCreditCardData,
} from "./credit-cards.repository";
import type { CreateCreditCardDto } from "./dto/create-credit-card.dto";
import type { ListCreditCardsQueryDto } from "./dto/list-credit-cards-query.dto";
import type { UpdateCreditCardDto } from "./dto/update-credit-card.dto";

export interface CreditCardList {
  data: CreditCardResponse[];
  meta: { page: number; pageSize: number; total: number };
}

@Injectable()
export class CreditCardsService {
  constructor(private readonly repo: CreditCardsRepository) {}

  async create(
    userId: string,
    dto: CreateCreditCardDto,
  ): Promise<CreditCardResponse> {
    const row = await this.repo.create(userId, {
      label: dto.label,
      closingDay: dto.closingDay,
      dueDay: dto.dueDay,
      creditLimitMinor:
        dto.creditLimitMinor === undefined
          ? null
          : toAmountBigInt(dto.creditLimitMinor),
    });
    return toCreditCardResponse(row);
  }

  async list(
    userId: string,
    query: ListCreditCardsQueryDto,
  ): Promise<CreditCardList> {
    const { rows, total } = await this.repo.findManyWithCount(userId, {
      active: query.active,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return {
      data: rows.map(toCreditCardResponse),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async get(userId: string, id: string): Promise<CreditCardResponse> {
    const row = await this.repo.findOwned(userId, id);
    if (!row) {
      throw new NotFoundException();
    }
    return toCreditCardResponse(row);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateCreditCardDto,
  ): Promise<CreditCardResponse> {
    const hasField =
      dto.label !== undefined ||
      dto.closingDay !== undefined ||
      dto.dueDay !== undefined ||
      dto.creditLimitMinor !== undefined;
    if (!hasField) {
      throw new BadRequestException("At least one field must be provided");
    }

    const existing = await this.repo.findOwned(userId, id);
    if (!existing) {
      throw new NotFoundException();
    }

    const data: UpdateCreditCardData = {};
    if (dto.label !== undefined) {
      data.label = dto.label;
    }
    if (dto.closingDay !== undefined) {
      data.closingDay = dto.closingDay;
    }
    if (dto.dueDay !== undefined) {
      data.dueDay = dto.dueDay;
    }
    if (dto.creditLimitMinor !== undefined) {
      data.creditLimitMinor = toAmountBigInt(dto.creditLimitMinor);
    }

    const row = await this.repo.updateOwned(userId, id, data);
    if (!row) {
      throw new NotFoundException();
    }
    return toCreditCardResponse(row);
  }

  /**
   * DELETE semantics: deactivate (set `isActive=false`), never hard-delete.
   * Already-generated card transactions/plans are preserved; only future
   * assignment against this card is prevented (purchases reject an inactive
   * card in the purchases flow). Changing `closingDay`/`dueDay` via `update`
   * likewise affects only future purchases (past rows are never reassigned).
   */
  async deactivate(userId: string, id: string): Promise<void> {
    const ok = await this.repo.deactivateOwned(userId, id);
    if (!ok) {
      throw new NotFoundException();
    }
  }
}
