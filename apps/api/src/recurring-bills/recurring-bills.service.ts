import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createMoney } from "@paypilot/shared";
import {
  toAmountBigInt,
  toAmountNumber,
  toDateOnly,
} from "../common/ledger-money-date";
import type { CreateRecurringBillDto } from "./dto/create-recurring-bill.dto";
import type { ListRecurringBillsQueryDto } from "./dto/list-recurring-bills-query.dto";
import type { UpdateRecurringBillDto } from "./dto/update-recurring-bill.dto";
import {
  type RecurringBillResponse,
  toRecurringBillResponse,
} from "./recurring-bill.mapper";
import {
  RecurringBillsRepository,
  type UpdateRecurringBillData,
} from "./recurring-bills.repository";

export interface RecurringBillList {
  data: RecurringBillResponse[];
  meta: { page: number; pageSize: number; total: number };
}

@Injectable()
export class RecurringBillsService {
  constructor(private readonly repo: RecurringBillsRepository) {}

  async create(
    userId: string,
    dto: CreateRecurringBillDto,
  ): Promise<RecurringBillResponse> {
    if (dto.endDate !== undefined && dto.endDate < dto.startDate) {
      throw new BadRequestException(
        "`endDate` must be on or after `startDate`",
      );
    }
    // Single source of money validation (safe-integer + ISO-4217).
    const money = createMoney(dto.amountMinor, dto.currency);
    const row = await this.repo.create(userId, {
      amountMinor: toAmountBigInt(money.amountMinor),
      currency: money.currency,
      dayOfMonth: dto.dayOfMonth,
      description: dto.description,
      categoryLabel: dto.category ?? null,
      startDate: toDateOnly(dto.startDate),
      endDate: dto.endDate ? toDateOnly(dto.endDate) : null,
    });
    return toRecurringBillResponse(row);
  }

  async list(
    userId: string,
    query: ListRecurringBillsQueryDto,
  ): Promise<RecurringBillList> {
    const { rows, total } = await this.repo.findManyWithCount(userId, {
      active: query.active,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return {
      data: rows.map(toRecurringBillResponse),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async get(userId: string, id: string): Promise<RecurringBillResponse> {
    const row = await this.repo.findOwned(userId, id);
    if (!row) {
      throw new NotFoundException();
    }
    return toRecurringBillResponse(row);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateRecurringBillDto,
  ): Promise<RecurringBillResponse> {
    const touchesMoney =
      dto.amountMinor !== undefined || dto.currency !== undefined;
    const hasField =
      touchesMoney ||
      dto.dayOfMonth !== undefined ||
      dto.description !== undefined ||
      dto.category !== undefined ||
      dto.startDate !== undefined ||
      dto.endDate !== undefined;
    if (!hasField) {
      throw new BadRequestException("At least one field must be provided");
    }

    const existing = await this.repo.findOwned(userId, id);
    if (!existing) {
      throw new NotFoundException();
    }

    // Validate the resulting window against the merged start/end dates.
    const effectiveStart =
      dto.startDate ?? existing.startDate.toISOString().slice(0, 10);
    const effectiveEnd =
      dto.endDate !== undefined
        ? dto.endDate
        : existing.endDate
          ? existing.endDate.toISOString().slice(0, 10)
          : undefined;
    if (effectiveEnd !== undefined && effectiveEnd < effectiveStart) {
      throw new BadRequestException(
        "`endDate` must be on or after `startDate`",
      );
    }

    const data: UpdateRecurringBillData = {};
    if (touchesMoney) {
      // Merge the patch with the persisted amount/currency, then re-validate.
      const money = createMoney(
        dto.amountMinor ?? toAmountNumber(existing.amountMinor),
        dto.currency ?? existing.currency,
      );
      data.amountMinor = toAmountBigInt(money.amountMinor);
      data.currency = money.currency;
    }
    if (dto.dayOfMonth !== undefined) {
      data.dayOfMonth = dto.dayOfMonth;
    }
    if (dto.description !== undefined) {
      data.description = dto.description;
    }
    if (dto.category !== undefined) {
      data.categoryLabel = dto.category ?? null;
    }
    if (dto.startDate !== undefined) {
      data.startDate = toDateOnly(dto.startDate);
    }
    if (dto.endDate !== undefined) {
      data.endDate = dto.endDate ? toDateOnly(dto.endDate) : null;
    }

    const row = await this.repo.updateOwned(userId, id, data);
    if (!row) {
      throw new NotFoundException();
    }
    return toRecurringBillResponse(row);
  }

  /**
   * DELETE semantics: deactivate (set `isActive=false`), never hard-delete.
   * Already-generated transactions are preserved; only future generation stops.
   */
  async deactivate(userId: string, id: string): Promise<void> {
    const ok = await this.repo.deactivateOwned(userId, id);
    if (!ok) {
      throw new NotFoundException();
    }
  }
}
