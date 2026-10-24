// Dữ liệu demo: cửa hàng "Tiệm Cầm Đồ Demo" với lịch sử ~60 ngày, mọi thao tác tiền đi qua use case thật (sổ két, audit,
// tính lãi do code ứng dụng sinh). Dữ liệu cá nhân là giả. Chạy qua scripts/seed-demo.mjs, không import từ src/.
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import {
  createContract,
  createInstallment,
  createStaff,
  getContractDetail,
  payInstallment,
  payInterest,
  recordManualEntry,
  redeemContract,
  setOpeningBalance,
} from "@/composition-root";
import { hashPassword } from "@/shared/infrastructure/auth/password";
import { db, pool } from "@/shared/infrastructure/db/client";
import { contracts, installmentContracts, users } from "@/shared/infrastructure/db/schema";
import { addDays, businessDate, diffDays, type LocalDate } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";
import type { ContractTerms } from "@/modules/pawn/domain/contract";

const DAYS = 60;
const OWNER_USERNAME = "demo";
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo12345";
const SHOP_NAME = "Tiệm Cầm Đồ Demo";

type Actor = { userId: string; shopId: string };
type Person = { fullName: string; cccd: string; phone: string; address: string };

// PRNG cố định hạt giống: chạy lại trên DB mới ra cùng một bộ dữ liệu (chỉ lệch theo ngày chạy).
let seed = 83;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const digits = (n: number) => Array.from({ length: n }, () => int(0, 9)).join("");
const million = (m: number) => Money.fromNumber(Math.round(m * 1_000_000));
const at = (date: LocalDate, hour = 9) => new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+07:00`);

const NAMES = [
  "Nguyễn Văn An", "Trần Thị Bích", "Lê Hoàng Cường", "Phạm Thị Dung", "Hoàng Minh Đức", "Huỳnh Thị Giang",
  "Phan Văn Hải", "Vũ Thị Hạnh", "Võ Quốc Huy", "Đặng Thị Kim", "Bùi Văn Long", "Đỗ Thị Mai",
  "Hồ Văn Nam", "Ngô Thị Ngọc", "Dương Văn Phúc", "Lý Thị Quyên", "Trương Văn Sơn", "Mai Thị Thảo",
  "Đinh Văn Tài", "Lâm Thị Thu", "Tạ Minh Tuấn", "Châu Thị Uyên", "Cao Văn Vinh", "Kiều Thị Xuân",
  "Nguyễn Thành Đạt", "Trần Ngọc Hân", "Lê Văn Khánh", "Phạm Minh Luân", "Võ Thị Như", "Huỳnh Tấn Phát",
];
const STREETS = [
  "Nguyễn Trãi, P. Bến Thành, Q.1", "Lê Văn Sỹ, P.13, Q.3", "Cách Mạng Tháng 8, P.5, Q.Tân Bình",
  "Nguyễn Văn Linh, P. Tân Phong, Q.7", "Quang Trung, P.10, Q. Gò Vấp", "Lý Thường Kiệt, P.7, Q.10",
  "Phan Văn Trị, P.11, Q. Bình Thạnh", "Kinh Dương Vương, P. An Lạc, Q. Bình Tân",
];
const PHONE_PREFIX = ["090", "093", "097", "098", "032", "035", "038", "070", "077", "086"];

const people: Person[] = NAMES.map((fullName) => ({
  fullName,
  // 079 = mã tỉnh TP.HCM; số còn lại ngẫu nhiên, không phải CCCD của ai.
  cccd: `079${pick(["0", "1", "2", "3"])}${digits(8)}`,
  phone: `${pick(PHONE_PREFIX)}${digits(7)}`,
  address: `${int(1, 450)} ${pick(STREETS)}, TP.HCM`,
}));

// Tài sản cầm đồ kèm khoảng tiền vay (triệu đồng).
const ASSETS: { name: () => string; min: number; max: number }[] = [
  { name: () => `Xe Honda Wave Alpha ${int(2016, 2022)}, BKS 59-${pick(["X1", "T2", "F1", "N3"])} ${digits(3)}.${digits(2)}`, min: 5, max: 9 },
  { name: () => `Xe Honda Air Blade ${int(2018, 2023)}, BKS 59-${pick(["X2", "H1", "P3"])} ${digits(3)}.${digits(2)}`, min: 12, max: 20 },
  { name: () => `Xe Yamaha Exciter 155, BKS 59-${pick(["V1", "G2", "S3"])} ${digits(3)}.${digits(2)}`, min: 15, max: 25 },
  { name: () => `iPhone ${pick(["13", "14", "15"])} Pro Max ${pick(["128GB", "256GB"])}`, min: 6, max: 14 },
  { name: () => `Samsung Galaxy ${pick(["S23", "S24", "A55"])}`, min: 3, max: 9 },
  { name: () => `Nhẫn vàng 18K ${int(1, 3)} chỉ`, min: 4, max: 10 },
  { name: () => `Dây chuyền vàng 24K ${int(1, 2)} chỉ`, min: 8, max: 16 },
  { name: () => `Laptop ${pick(["Dell Latitude 7420", "MacBook Air M2", "Asus Vivobook 15"])}`, min: 4, max: 12 },
  { name: () => `Đồng hồ ${pick(["Casio Edifice", "Citizen Eco-Drive", "Orient Bambino"])}`, min: 2, max: 5 },
];

type Plan = {
  terms: ContractTerms;
  person: Person;
  /** good: đóng lãi đúng hạn; late: đóng 0–1 kỳ rồi ngưng (quá hạn); redeem: chuộc / đóng HĐ vào ngày `redeemOn`. */
  behavior: "good" | "late" | "redeem";
  redeemOn: LocalDate | null;
  actor: Actor;
  id?: string;
  paidPeriods: number;
};

type InstallmentPlan = {
  person: Person;
  amountGiven: Money;
  totalDue: Money;
  totalDays: number;
  periodDays: number;
  startDate: LocalDate;
  /** good: góp đủ từng kỳ; late: góp 1 kỳ rồi ngưng (chậm góp). Hết kỳ góp đủ thì hợp đồng tự đóng. */
  behavior: "good" | "late";
  actor: Actor;
  id?: string;
  paid: Money;
};

const ok = (label: string, result: unknown) => {
  const failed = typeof result === "string" ? result !== "ok" : !(result as { ok: boolean }).ok;
  if (failed) throw new Error(`${label}: ${JSON.stringify(result)}`);
};

async function createShop(start: LocalDate): Promise<Actor> {
  const exists = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${OWNER_USERNAME}`);
  if (exists.length > 0) {
    throw new Error(`Đã có tài khoản '${OWNER_USERNAME}': dữ liệu demo đã nạp. Muốn làm lại thì tạo lại DB (drop, create, migrate).`);
  }
  const passwordHash = await hashPassword(PASSWORD);
  return db.transaction(async (tx) => {
    const shop = await tx.execute<{ id: string }>(
      sql`INSERT INTO shops (name, phone, address, opened_at, trial_ends_at)
          VALUES (${SHOP_NAME}, '0283 888 8383', '83 Nguyễn Thị Minh Khai, P. Bến Nghé, Q.1, TP.HCM', ${start},
                  now() + interval '30 days') RETURNING id`,
    );
    const shopId = shop.rows[0].id;
    const user = await tx.execute<{ id: string }>(
      sql`INSERT INTO users (shop_id, name, email, email_verified, username, display_username, role)
          VALUES (${shopId}, 'Chủ tiệm Demo', 'demo@example.com', true, ${OWNER_USERNAME}, ${OWNER_USERNAME}, 'owner') RETURNING id`,
    );
    const userId = user.rows[0].id;
    await tx.execute(
      sql`INSERT INTO accounts (user_id, account_id, provider_id, password) VALUES (${userId}, ${userId}, 'credential', ${passwordHash})`,
    );
    return { shopId, userId };
  });
}

async function addStaff(owner: Actor, name: string, username: string): Promise<Actor> {
  ok(`Tạo KTV ${username}`, await createStaff.execute(owner, { name, username, password: PASSWORD }));
  const [row] = await db.select({ id: users.id }).from(users).where(and(eq(users.shopId, owner.shopId), eq(users.username, username)));
  return { shopId: owner.shopId, userId: row.id };
}

function planContracts(start: LocalDate, today: LocalDate, actors: Actor[]): Plan[] {
  const plans: Plan[] = [];
  for (let i = 0; i < 28; i++) {
    // 24 khách đầu mỗi người một hợp đồng; 4 hợp đồng sau là khách quay lại (trùng CCCD → dùng lại khách cũ).
    const person = i < 24 ? people[i] : people[int(0, 23)];
    const loanDate = addDays(start, int(1, DAYS - 1));
    const unsecured = rand() < 0.3;
    let terms: Plan["terms"];
    if (unsecured) {
      terms = {
        kind: "unsecured", assetName: null, principal: million(int(5, 20)),
        interestType: "percent_per_month", interestRate: 40_000n, interestPeriodDays: 30, termDays: 90,
        loanDate, prepaidInterest: rand() < 0.5,
      };
    } else {
      const asset = pick(ASSETS);
      const principal = million(int(asset.min * 2, asset.max * 2) / 2);
      const style = rand();
      terms =
        style < 0.65
          ? { kind: "secured", assetName: asset.name(), principal, interestType: "per_million_per_day", interestRate: 30_000n,
              interestPeriodDays: 10, termDays: 30, loanDate, prepaidInterest: false }
          : style < 0.9
            ? { kind: "secured", assetName: asset.name(), principal, interestType: "percent_per_month", interestRate: 30_000n,
                interestPeriodDays: 30, termDays: 60, loanDate, prepaidInterest: false }
            : { kind: "secured", assetName: asset.name(), principal, interestType: "percent_per_week", interestRate: 15_000n,
                interestPeriodDays: 7, termDays: 28, loanDate, prepaidInterest: false };
    }
    const r = rand();
    let behavior: Plan["behavior"] = r < 0.55 ? "good" : r < 0.75 ? "late" : "redeem";
    let redeemOn: LocalDate | null = null;
    if (behavior === "redeem") {
      // Chuộc sau ít nhất một kỳ; ngày chuộc rơi vào tương lai thì coi là khách đóng lãi đều.
      const candidate = addDays(loanDate, terms.interestPeriodDays + int(0, terms.interestPeriodDays));
      if (terms.prepaidInterest || diffDays(candidate, today) <= 0) behavior = "good";
      else redeemOn = candidate;
    }
    plans.push({ terms, person, behavior, redeemOn, actor: pick(actors), paidPeriods: 0 });
  }
  // Kịch bản cố định để trang chủ, lọc "Quá hạn" / "Sắp đến hạn" luôn có dữ liệu: cầm đồ kỳ 10 ngày mở cách hôm nay `ago` ngày.
  // 4 HĐ ngưng đóng lãi (quá hạn 6–15 ngày), 1 HĐ đóng đều nên đến hạn đúng hôm nay, 2 HĐ mở hôm nay.
  const fixed: { ago: number; behavior: Plan["behavior"] }[] = [
    { ago: 35, behavior: "late" }, { ago: 28, behavior: "late" }, { ago: 22, behavior: "late" }, { ago: 16, behavior: "late" },
    { ago: 20, behavior: "good" }, { ago: 0, behavior: "good" }, { ago: 0, behavior: "good" },
  ];
  fixed.forEach(({ ago, behavior }, i) => {
    const asset = pick(ASSETS);
    plans[i].terms = {
      kind: "secured", assetName: asset.name(), principal: million(int(asset.min, asset.max)),
      interestType: "per_million_per_day", interestRate: 30_000n, interestPeriodDays: 10, termDays: 30,
      loanDate: addDays(today, -ago), prepaidInterest: false,
    };
    plans[i].behavior = behavior;
    plans[i].redeemOn = null;
  });
  return plans;
}

function planInstallments(start: LocalDate, today: LocalDate, actors: Actor[]): InstallmentPlan[] {
  const plans: InstallmentPlan[] = [];
  for (let i = 0; i < 9; i++) {
    const given = pick([5, 8, 10, 12, 15, 20]);
    // Ba hợp đồng đầu ngắn (30 ngày) và mở sớm: góp đủ thì tự đóng.
    const short = i < 3;
    const totalDays = short ? 30 : 50;
    // Hai hợp đồng góp 1 kỳ rồi ngưng, mở cách hôm nay 35 và 25 ngày: chậm 2 kỳ và 1 kỳ.
    const late = i === 3 || i === 4;
    plans.push({
      person: i < 6 ? people[24 + i] : people[int(0, 23)],
      amountGiven: million(given),
      totalDue: million(given * 1.2),
      totalDays,
      periodDays: 10,
      startDate: late ? addDays(today, i === 3 ? -35 : -25) : addDays(start, short ? int(3, 15) : int(5, DAYS - 5)),
      behavior: late ? "late" : "good",
      actor: pick(actors),
      paid: Money.ZERO,
    });
  }
  return plans;
}

async function contractId(shopId: string, code: string): Promise<string> {
  const [row] = await db.select({ id: contracts.id }).from(contracts).where(and(eq(contracts.shopId, shopId), eq(contracts.code, code)));
  return row.id;
}

async function installmentId(shopId: string, code: string): Promise<string> {
  const [row] = await db
    .select({ id: installmentContracts.id })
    .from(installmentContracts)
    .where(and(eq(installmentContracts.shopId, shopId), eq(installmentContracts.code, code)));
  return row.id;
}

/** Một ngày làm việc: chi phí, hợp đồng tới hạn, hợp đồng mới. Hôm nay không ai đóng lãi để trang chủ có hợp đồng đến hạn. */
async function simulateDay(
  d: LocalDate, today: LocalDate, owner: Actor, actors: Actor[], plans: Plan[], installments: InstallmentPlan[],
) {
  const now = at(d);
  const dayIndex = diffDays(addDays(today, -DAYS), d);

  if (dayIndex === 25) {
    ok("Nạp vốn", await recordManualEntry.execute(owner, { type: "capital_in", amount: million(100), note: "Chủ tiệm bổ sung vốn" }, now));
  }
  if (d.endsWith("-05")) {
    ok("Chi thuê nhà", await recordManualEntry.execute(owner, { type: "manual_expense", amount: million(8), note: "Tiền thuê mặt bằng tháng" }, now));
  }
  if (d.endsWith("-10")) {
    ok("Chi điện nước", await recordManualEntry.execute(owner, { type: "manual_expense", amount: million(1.35), note: "Tiền điện nước" }, now));
  }
  if (rand() < 0.35) {
    ok("Chi ăn trưa", await recordManualEntry.execute(pick(actors), { type: "manual_expense", amount: Money.fromNumber(int(2, 5) * 50_000), note: "Cơm trưa nhân viên" }, now));
  }
  if (rand() < 0.08) {
    ok("Thu khác", await recordManualEntry.execute(pick(actors), { type: "manual_income", amount: million(int(1, 5) / 2), note: "Bán đồ thanh lý" }, now));
  }

  for (const p of plans) {
    if (!p.id || d === today) continue;
    const detail = await getContractDetail.execute(p.actor.shopId, p.id, now);
    if (!detail?.open) continue;
    const { contract } = detail;
    if (p.redeemOn === d) {
      ok(`Chuộc ${contract.code}`, await redeemContract.execute(pick(actors), {
        contractId: p.id, expectedPaidUntil: contract.interestPaidUntil, expectedOutstanding: contract.outstandingPrincipal,
        asOf: d, interest: null,
      }, now));
      continue;
    }
    const stillPaying = p.behavior !== "late" || p.paidPeriods < (p.terms.loanDate < addDays(today, -25) ? 1 : 0);
    if (stillPaying && diffDays(detail.open.nextInterestDue, d) >= 0) {
      ok(`Đóng lãi ${contract.code}`, await payInterest.execute(pick(actors), {
        contractId: p.id, periods: 1, expectedPaidUntil: contract.interestPaidUntil, amount: null,
      }, now));
      p.paidPeriods++;
    }
  }

  for (const k of installments) {
    if (!k.id || d === today || k.paid.equals(k.totalDue)) continue;
    const day = diffDays(k.startDate, d);
    if (day <= 0 || day % k.periodDays !== 0) continue;
    const periods = k.totalDays / k.periodDays;
    const n = day / k.periodDays;
    if (n > periods || (k.behavior === "late" && n > 1)) continue;
    const amount = n === periods ? k.totalDue.subtract(k.paid) : k.totalDue.mulDiv(1n, BigInt(periods));
    ok(`Góp ${k.id}`, await payInstallment.execute(pick(actors), { contractId: k.id, expectedPaid: k.paid, amount }, now));
    k.paid = k.paid.add(amount);
  }

  for (const p of plans) {
    if (p.terms.loanDate !== d) continue;
    const result = await createContract.execute(p.actor, {
      terms: p.terms,
      customer: { fullName: p.person.fullName, cccd: p.person.cccd, phone: p.person.phone, address: p.person.address },
      staffId: p.actor.userId,
      note: null,
    }, now);
    if (!result.ok) throw new Error(`Tạo HĐ: ${JSON.stringify(result)}`);
    p.id = await contractId(p.actor.shopId, result.code);
  }

  for (const k of installments) {
    if (k.startDate !== d) continue;
    const result = await createInstallment.execute(k.actor, {
      terms: { amountGiven: k.amountGiven, totalDue: k.totalDue, totalDays: k.totalDays, periodDays: k.periodDays, startDate: d },
      customer: { fullName: k.person.fullName, cccd: k.person.cccd, phone: k.person.phone, address: k.person.address },
      note: null,
    }, now);
    if (!result.ok) throw new Error(`Tạo trả góp: ${JSON.stringify(result)}`);
    k.id = await installmentId(k.actor.shopId, result.code);
  }
}

/**
 * Use case ghi giờ thật lúc chạy script (`now()` của DB), nên giao dịch "40 ngày trước" vẫn mang giờ hôm nay. Chỉ cho cửa hàng
 * demo, bằng superuser trong một transaction: dời giờ về đúng ngày nghiệp vụ (07:30 + 15 phút mỗi thao tác), tạm tắt trigger
 * append-only của sổ két rồi bật lại ngay. Không đổi số tiền, ngày nghiệp vụ hay liên kết nào.
 */
async function backdateTimestamps(shopId: string) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.username = "postgres";
  url.password = readFileSync(new URL("../../.local/pwfile", import.meta.url), "utf8").trim();
  const admin = new Pool({ connectionString: url.toString(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query("BEGIN");
    await c.query("ALTER TABLE cash_transactions DISABLE TRIGGER cash_transactions_append_only");
    await c.query(
      `WITH op AS (
         SELECT operation_id, business_date, min(occurred_at) AS first_at
         FROM cash_transactions WHERE shop_id = $1 GROUP BY operation_id, business_date
       ), r AS (
         SELECT operation_id, business_date,
                row_number() OVER (PARTITION BY business_date ORDER BY first_at, operation_id) AS n
         FROM op
       )
       UPDATE cash_transactions t
       SET occurred_at = (r.business_date + time '07:30' + r.n * interval '15 minutes') AT TIME ZONE 'Asia/Ho_Chi_Minh'
       FROM r WHERE t.shop_id = $1 AND t.operation_id = r.operation_id AND t.business_date = r.business_date`,
      [shopId],
    );
    await c.query("ALTER TABLE cash_transactions ENABLE TRIGGER cash_transactions_append_only");
    for (const table of ["contract_operations", "installment_operations"]) {
      await c.query(
        `UPDATE ${table} o SET created_at = x.at
         FROM (SELECT operation_id, min(occurred_at) AS at FROM cash_transactions WHERE shop_id = $1 GROUP BY operation_id) x
         WHERE o.shop_id = $1 AND o.id = x.operation_id`,
        [shopId],
      );
    }
    await c.query(
      `UPDATE contracts k SET created_at = o.created_at, updated_at = o.created_at FROM contract_operations o
       WHERE k.shop_id = $1 AND o.shop_id = $1 AND o.contract_id = k.id AND o.kind = 'disbursement'`,
      [shopId],
    );
    await c.query(
      `UPDATE installment_contracts k SET created_at = o.created_at, updated_at = o.created_at FROM installment_operations o
       WHERE k.shop_id = $1 AND o.shop_id = $1 AND o.installment_contract_id = k.id AND o.kind = 'disbursement'`,
      [shopId],
    );
    await c.query(
      `UPDATE customers cu SET created_at = x.at, updated_at = x.at
       FROM (SELECT customer_id, min(created_at) AS at FROM (
               SELECT customer_id, created_at FROM contracts WHERE shop_id = $1
               UNION ALL SELECT customer_id, created_at FROM installment_contracts WHERE shop_id = $1) a
             GROUP BY customer_id) x
       WHERE cu.shop_id = $1 AND cu.id = x.customer_id`,
      [shopId],
    );
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
    await admin.end();
  }
}

export async function run() {
  try {
    const today = businessDate(new Date());
    const start = addDays(today, -DAYS);
    const owner = await createShop(start);
    const lan = await addStaff(owner, "Nguyễn Thị Lan", "ktv.lan");
    const hung = await addStaff(owner, "Trần Văn Hùng", "ktv.hung");
    const actors = [owner, lan, hung];

    ok("Quỹ đầu két", await setOpeningBalance.execute(owner, million(300)));
    const plans = planContracts(start, today, actors);
    const installments = planInstallments(start, today, actors);
    for (let d = start; diffDays(d, today) >= 0; d = addDays(d, 1)) {
      await simulateDay(d, today, owner, actors, plans, installments);
    }
    await backdateTimestamps(owner.shopId);

    console.log(`Đã tạo '${SHOP_NAME}' (${start} → ${today}): ${plans.length} HĐ cầm đồ/tín chấp, ${installments.length} HĐ trả góp.`);
    console.log(`Đăng nhập: ${OWNER_USERNAME} (chủ tiệm), ktv.lan, ktv.hung — mật khẩu ${PASSWORD}`);
  } finally {
    await pool.end();
  }
}
