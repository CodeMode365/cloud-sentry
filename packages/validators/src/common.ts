import { z } from 'zod';

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(4096).optional(),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

export const noteSchema = z.string().trim().max(1000).optional();

/** Accepts the header value used for idempotent POSTs. */
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'Idempotency-Key may contain only letters, digits and _ . : -');

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

/** Splits a comma-separated query parameter into an array before validation. */
export function csvArray<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return undefined;
    if (Array.isArray(v)) return v;
    return String(v)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }, z.array(item).max(50).optional());
}
