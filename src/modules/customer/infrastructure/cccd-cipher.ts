import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { maskCccd } from "@/shared/kernel/personal-data";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Mã hoá CCCD (AES-256-GCM) và băm để tìm khớp chính xác (HMAC-SHA256), hai khoá tách riêng (data-model mục 3.3).
 * `shop_id` là AAD của bản mã và nằm trong dữ liệu băm: không tráo bản mã sang cửa hàng khác được,
 * và cùng một CCCD ở hai cửa hàng cho hai hash khác nhau (lộ DB cũng không nối được khách giữa các cửa hàng).
 */
export class CccdCipher {
  constructor(
    private readonly encryptionKey: Buffer,
    private readonly hmacKey: Buffer,
  ) {
    if (encryptionKey.length !== 32 || hmacKey.length !== 32) throw new Error("Khoá CCCD phải dài 32 byte");
    if (encryptionKey.equals(hmacKey)) throw new Error("Khoá mã hoá và khoá HMAC của CCCD phải khác nhau");
  }

  /** Đọc khoá từ biến môi trường (base64, 32 byte); thiếu thì báo lỗi, không có khoá mặc định. */
  static fromEnv(env: Record<string, string | undefined> = process.env): CccdCipher {
    const key = (name: string) => {
      const value = env[name];
      if (!value) throw new Error(`Thiếu biến môi trường ${name}`);
      return Buffer.from(value, "base64");
    };
    return new CccdCipher(key("CCCD_ENCRYPTION_KEY"), key("CCCD_HMAC_KEY"));
  }

  encrypt(shopId: string, cccd: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(shopId));
    const ciphertext = Buffer.concat([cipher.update(cccd, "utf8"), cipher.final()]);
    return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
  }

  decrypt(shopId: string, payload: string): string {
    const [version, body] = payload.split(":");
    if (version !== VERSION || !body) throw new Error("Bản mã CCCD không đúng định dạng");
    const raw = Buffer.from(body, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, raw.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(shopId));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
  }

  hash(shopId: string, cccd: string): string {
    return createHmac("sha256", this.hmacKey).update(`${shopId}:${cccd}`).digest("hex");
  }
}

/** Ba cột CCCD của bảng customers cho một CCCD đã chuẩn hoá. */
export function cccdColumns(cipher: CccdCipher, shopId: string, cccd: string) {
  return { cccdEncrypted: cipher.encrypt(shopId, cccd), cccdHash: cipher.hash(shopId, cccd), cccdMasked: maskCccd(cccd) };
}
