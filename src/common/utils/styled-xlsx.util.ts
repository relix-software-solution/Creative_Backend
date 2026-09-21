import * as XLSX from 'xlsx-js-style';

export type StyledXlsxColumn = {
  wch: number;
};

type StyledCell = XLSX.CellObject & {
  s?: Record<string, unknown>;
};

const THIN_BORDER = {
  top: { style: 'thin', color: { rgb: 'E3E3E8' } },
  bottom: { style: 'thin', color: { rgb: 'E3E3E8' } },
  left: { style: 'thin', color: { rgb: 'E3E3E8' } },
  right: { style: 'thin', color: { rgb: 'E3E3E8' } },
};

const HEADER_STYLE = {
  font: {
    name: 'Arial',
    bold: true,
    color: { rgb: 'FFFFFF' },
    sz: 11,
  },
  fill: {
    patternType: 'solid',
    fgColor: { rgb: 'A88042' },
  },
  alignment: {
    horizontal: 'center',
    vertical: 'center',
    wrapText: true,
  },
  border: THIN_BORDER,
};

const DATA_STYLE = {
  font: {
    name: 'Arial',
    color: { rgb: '252525' },
    sz: 10,
  },
  alignment: {
    horizontal: 'center',
    vertical: 'center',
    wrapText: true,
  },
  border: THIN_BORDER,
};

const ALTERNATE_DATA_STYLE = {
  ...DATA_STYLE,
  fill: {
    patternType: 'solid',
    fgColor: { rgb: 'F8F8FF' },
  },
};

export function createStyledXlsxBuffer(input: {
  rows: unknown[][];
  columns: StyledXlsxColumn[];
  sheetName?: string;
}): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet(input.rows);
  const sheetName = input.sheetName ?? 'Registrations';

  worksheet['!cols'] = input.columns;
  worksheet['!rows'] = input.rows.map((_, index) => ({
    hpt: index === 0 ? 28 : 24,
  }));

  if (worksheet['!ref']) {
    worksheet['!autofilter'] = {
      ref: worksheet['!ref'],
    };

    const range = XLSX.utils.decode_range(worksheet['!ref']);

    for (let row = range.s.r; row <= range.e.r; row += 1) {
      const style =
        row === 0
          ? HEADER_STYLE
          : row % 2 === 0
            ? ALTERNATE_DATA_STYLE
            : DATA_STYLE;

      for (let column = range.s.c; column <= range.e.c; column += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: column });
        const cell = worksheet[address] as StyledCell | undefined;

        if (!cell) {
          continue;
        }

        // A phone number is an identifier, never a numeric Excel value.
        // Explicit string typing prevents formula evaluation without adding a
        // visible apostrophe to the cell contents.
        if (typeof cell.v === 'string') {
          cell.t = 's';
          delete cell.f;
        }
        cell.s = row > 0 && column === 2
          ? { ...style, numFmt: '@' }
          : style;
      }
    }
  }

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  const output = XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'buffer',
    compression: true,
    cellStyles: true,
  }) as Buffer | Uint8Array;

  return Buffer.isBuffer(output) ? output : Buffer.from(output);
}
