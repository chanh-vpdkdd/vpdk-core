/**
 * Chuẩn hóa chuỗi tìm kiếm / index — thống nhất đ→d và bỏ dấu.
 * Dùng chung cho index (searchText) và query.
 */
export function normalizeSearchText(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Tách token: bỏ dấu câu, giữ chữ/số, độ dài ≥ 2. */
export function tokenizeSearchText(text: string): string[] {
  return normalizeSearchText(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2)
}
