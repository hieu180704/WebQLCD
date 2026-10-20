// Chuẩn hoá và che dữ liệu cá nhân của khách (web-security: danh sách hiển thị che bớt CCCD, SĐT).

/** CCCD 12 số hoặc CMND cũ 9 số, bỏ khoảng trắng. Sai định dạng thì null. */
export function normalizeCccd(text: string): string | null {
  const digits = text.replace(/\s/g, "");
  return /^(\d{9}|\d{12})$/.test(digits) ? digits : null;
}

/** Chỉ giữ 4 số cuối: "001099012345" → "********2345". */
export function maskCccd(cccd: string): string {
  return "*".repeat(cccd.length - 4) + cccd.slice(-4);
}

/** Bỏ khoảng trắng, dấu chấm, gạch; giữ dấu + đầu. 8–15 chữ số, sai thì null. */
export function normalizePhone(text: string): string | null {
  const compact = text.replace(/[\s.\-()]/g, "");
  return /^\+?\d{8,15}$/.test(compact) ? compact : null;
}

/** Giữ 3 số đầu và 3 số cuối: "0912345678" → "091****678". */
export function maskPhone(phone: string): string {
  if (phone.length <= 6) return "*".repeat(phone.length);
  return phone.slice(0, 3) + "*".repeat(phone.length - 6) + phone.slice(-3);
}
