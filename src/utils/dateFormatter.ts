export type DateFormatterInput = string | number | Date | null | undefined;

export interface DateFormatterOptions {
  locale?: string;
  formatOptions?: Intl.DateTimeFormatOptions;
  fallback?: string;
}

const defaultFormat: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

function toDate(input: DateFormatterInput): Date | null {
  if (input === null || input === undefined) {
    return null;
  }

  if (typeof input === "string") {
    if (input.trim() === "") {
      return null;
    }
    return new Date(input);
  }

  if (typeof input === "number") {
    return new Date(input);
  }

  if (input instanceof Date) {
    return input;
  }

  return null;
}

export function formatDate(
  input: DateFormatterInput,
  { locale = "en-US", formatOptions = defaultFormat, fallback = "" }: DateFormatterOptions = {},
): string {
  const date = toDate(input);

  if (!date || Number.isNaN(date.getTime())) {
    return fallback;
  }

  return new Intl.DateTimeFormat(locale, formatOptions).format(date);
}
