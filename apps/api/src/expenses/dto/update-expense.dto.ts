import { PartialType } from "@nestjs/mapped-types";
import { CreateExpenseDto } from "./create-expense.dto";

/** PATCH: every editable field optional. Empty body is rejected in the service. */
export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}
