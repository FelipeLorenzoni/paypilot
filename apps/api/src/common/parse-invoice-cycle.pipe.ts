import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from "@nestjs/common";

const INVOICE_CYCLE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Validates an invoice-cycle path param as `YYYY-MM` (months 01–12). Rejects a
 * malformed value with a 400 (canonical VALIDATION_ERROR via the global filter)
 * before the controller/service run.
 */
@Injectable()
export class ParseInvoiceCyclePipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== "string" || !INVOICE_CYCLE.test(value)) {
      throw new BadRequestException("cycle must be a valid YYYY-MM value");
    }
    return value;
  }
}
