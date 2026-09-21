const DANGEROUS_FORMULA_PREFIX = /^[\s\u0000-\u001f]*[=+\-@]/u;

/**
 * يمنع Excel Formula Injection عبر إجبار القيم الخطرة على أن تُعامل كنص.
 */
export function sanitizeSpreadsheetCell(
  value: string | null | undefined,
): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (DANGEROUS_FORMULA_PREFIX.test(value)) {
    return `'${value}`;
  }

  return value;
}
