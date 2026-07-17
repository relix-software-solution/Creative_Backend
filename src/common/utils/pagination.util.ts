import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { PaginatedResponse } from '../types/paginated-response.type';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function normalizePagination(query: PaginationQueryDto) {
  const page = Math.max(query.page ?? DEFAULT_PAGE, DEFAULT_PAGE);
  const limit = Math.min(
    Math.max(query.limit ?? DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

export function createPaginatedResponse<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResponse<T> {
  return {
    items,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}
