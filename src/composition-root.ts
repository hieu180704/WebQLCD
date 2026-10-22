// Nơi duy nhất ghép implementation vào use case (architecture-spec mục 2.3).
import "server-only";
import { GetCashDay } from "@/modules/cashbook/application/get-cash-day";
import { RecordManualEntry } from "@/modules/cashbook/application/record-manual-entry";
import { SetOpeningBalance } from "@/modules/cashbook/application/set-opening-balance";
import { appendCashEntries } from "@/modules/cashbook/infrastructure/cash-ledger";
import { DrizzleCashbookRepository } from "@/modules/cashbook/infrastructure/drizzle-cashbook-repository";
import { CccdCipher, DrizzleCustomerWriter } from "@/modules/customer";
import { CreateStaff } from "@/modules/identity/application/create-staff";
import { ListStaff } from "@/modules/identity/application/list-staff";
import { RegisterOwner } from "@/modules/identity/application/register-owner";
import { SignIn } from "@/modules/identity/application/sign-in";
import { SignOut } from "@/modules/identity/application/sign-out";
import { BetterAuthAuthenticator } from "@/modules/identity/infrastructure/better-auth-authenticator";
import { DrizzleAccountRepository } from "@/modules/identity/infrastructure/drizzle-account-repository";
import { IpSignupLimiter } from "@/modules/identity/infrastructure/ip-signup-limiter";
import { GetSubscription } from "@/modules/shop/application/get-subscription";
import { ChangePrincipal } from "@/modules/pawn/application/change-principal";
import { CreateContract } from "@/modules/pawn/application/create-contract";
import { DeleteContract } from "@/modules/pawn/application/delete-contract";
import { EditContract } from "@/modules/pawn/application/edit-contract";
import { ExtendContract } from "@/modules/pawn/application/extend-contract";
import { GetContractDetail } from "@/modules/pawn/application/get-contract-detail";
import { ListContracts } from "@/modules/pawn/application/list-contracts";
import { PayInterest } from "@/modules/pawn/application/pay-interest";
import { RedeemContract } from "@/modules/pawn/application/redeem-contract";
import { ReverseOperation } from "@/modules/pawn/application/reverse-operation";
import { DrizzleContractRepository } from "@/modules/pawn/infrastructure/drizzle-contract-repository";
import { DrizzleShopRepository } from "@/modules/shop/infrastructure/drizzle-shop-repository";
import { db } from "@/shared/infrastructure/db/client";

// Lớp presentation không import thẳng shared/infrastructure, nên guard và luật mật khẩu được đưa ra qua đây.
export { requireProfile, requireSession } from "@/shared/infrastructure/auth/guard";
export { AccessDeniedError } from "@/shared/infrastructure/auth/access";
export { MIN_PASSWORD_LENGTH } from "@/shared/infrastructure/auth/password";

const authenticator = new BetterAuthAuthenticator();
export const signIn = new SignIn(authenticator);
export const signOut = new SignOut(authenticator);

const accounts = new DrizzleAccountRepository(db);
export const registerOwner = new RegisterOwner(new IpSignupLimiter(db), accounts, authenticator);
export const createStaff = new CreateStaff(accounts);
export const listStaff = new ListStaff(accounts);

export const getSubscription = new GetSubscription(new DrizzleShopRepository(db));

const cashbook = new DrizzleCashbookRepository(db);
export const setOpeningBalance = new SetOpeningBalance(cashbook);
export const getCashDay = new GetCashDay(cashbook);
export const recordManualEntry = new RecordManualEntry(cashbook);

// Khoá CCCD đọc lần đầu cần dùng rồi giữ lại; thiếu khoá thì chỉ thao tác có CCCD báo lỗi.
let cccdCipher: CccdCipher | undefined;
const customerWriter = new DrizzleCustomerWriter(() => (cccdCipher ??= CccdCipher.fromEnv()));
const contracts = new DrizzleContractRepository(db, customerWriter, appendCashEntries);
export const createContract = new CreateContract(contracts);
export const listContracts = new ListContracts(contracts);
export const getContractDetail = new GetContractDetail(contracts);
export const payInterest = new PayInterest(contracts);
export const redeemContract = new RedeemContract(contracts);
export const changePrincipal = new ChangePrincipal(contracts);
export const extendContract = new ExtendContract(contracts);
export const reverseOperation = new ReverseOperation(contracts);
export const deleteContract = new DeleteContract(contracts);
export const editContract = new EditContract(contracts);
