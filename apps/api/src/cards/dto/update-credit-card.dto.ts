import { PartialType } from "@nestjs/mapped-types";
import { CreateCreditCardDto } from "./create-credit-card.dto";

/**
 * PATCH: every editable field optional. An empty body is rejected in the
 * service. `isActive`/owner/`id`/timestamps are not editable fields and are
 * never part of this DTO (deactivation is done via DELETE).
 */
export class UpdateCreditCardDto extends PartialType(CreateCreditCardDto) {}
