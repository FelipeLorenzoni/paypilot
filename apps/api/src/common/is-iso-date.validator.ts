import { registerDecorator, type ValidationOptions } from "class-validator";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a real `YYYY-MM-DD` calendar date (rejects e.g. 2026-02-30). */
export function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/** class-validator decorator wrapping {@link isIsoCalendarDate}. */
export function IsIsoCalendarDate(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: "isIsoCalendarDate",
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => isIsoCalendarDate(value),
        defaultMessage: () => `${propertyName} must be a valid YYYY-MM-DD date`,
      },
    });
  };
}
