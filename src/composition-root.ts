// Nơi duy nhất ghép implementation vào use case (architecture-spec mục 2.3).
import "server-only";
import { GetCashDay } from "@/modules/cashbook/application/get-cash-day";
import { ListCashActors } from "@/modules/cashbook/application/list-cash-actors";
import { RecordManualEntry } from "@/modules/cashbook/application/record-manual-entry";
import { ReverseManualEntry } from "@/modules/cashbook/application/reverse-manual-entry";
import { SetOpeningBalance } from "@/modules/cashbook/application/set-opening-balance";
import { appendCashEntries } from "@/modules/cashbook/infrastructure/cash-ledger";
import { DrizzleCashbookRepository } from "@/modules/cashbook/infrastructure/drizzle-cashbook-repository";
import { EditCustomer, RevealCccd } from "@/modules/customer/application/edit-customer";
import { CccdCipher } from "@/modules/customer/infrastructure/cccd-cipher";
import { DrizzleCustomerRepository } from "@/modules/customer/infrastructure/drizzle-customer-repository";
import { DrizzleCustomerWriter } from "@/modules/customer/infrastructure/drizzle-customer-writer";
import { ChangeOwnPassword } from "@/modules/identity/application/change-own-password";
import { CreateStaff } from "@/modules/identity/application/create-staff";
import { ListStaff } from "@/modules/identity/application/list-staff";
import { ResetStaffPassword } from "@/modules/identity/application/reset-staff-password";
import { SetStaffActive } from "@/modules/identity/application/set-staff-active";
import { RegisterOwner } from "@/modules/identity/application/register-owner";
import { SignIn } from "@/modules/identity/application/sign-in";
import { SignOut } from "@/modules/identity/application/sign-out";
import { BetterAuthAuthenticator } from "@/modules/identity/infrastructure/better-auth-authenticator";
import { DrizzleAccountRepository } from "@/modules/identity/infrastructure/drizzle-account-repository";
import { IpSignupLimiter } from "@/modules/identity/infrastructure/ip-signup-limiter";
import { ThrottledPasswordChanger } from "@/modules/identity/infrastructure/throttled-password-changer";
import { GetSubscription } from "@/modules/shop/application/get-subscription";
import { ChangePrincipal } from "@/modules/pawn/application/change-principal";
import { CreateContract } from "@/modules/pawn/application/create-contract";
import { DeleteContract } from "@/modules/pawn/application/delete-contract";
import { EditContract } from "@/modules/pawn/application/edit-contract";
import { ExtendContract } from "@/modules/pawn/application/extend-contract";
import { GetContractDetail } from "@/modules/pawn/application/get-contract-detail";
import { ListContracts } from "@/modules/pawn/application/list-contracts";
import { ListDueContracts } from "@/modules/pawn/application/list-due-contracts";
import { PayInterest } from "@/modules/pawn/application/pay-interest";
import { RedeemContract } from "@/modules/pawn/application/redeem-contract";
import { ReverseOperation } from "@/modules/pawn/application/reverse-operation";
import { DrizzleContractRepository } from "@/modules/pawn/infrastructure/drizzle-contract-repository";
import { GetCashReport } from "@/modules/reporting/application/get-cash-report";
import { GetContractReport } from "@/modules/reporting/application/get-contract-report";
import { GetCustomerDetail } from "@/modules/reporting/application/get-customer-detail";
import { GetDashboardStats } from "@/modules/reporting/application/get-dashboard-stats";
import { ListCustomers } from "@/modules/reporting/application/list-customers";
import { DrizzleCashReport } from "@/modules/reporting/infrastructure/drizzle-cash-report";
import { DrizzleContractReport } from "@/modules/reporting/infrastructure/drizzle-contract-report";
import { DrizzleCustomerDirectory } from "@/modules/reporting/infrastructure/drizzle-customer-directory";
import { DrizzleCustomerProfile } from "@/modules/reporting/infrastructure/drizzle-customer-profile";
import { DrizzleDashboardStats } from "@/modules/reporting/infrastructure/drizzle-dashboard-stats";
import { DrizzleShopRepository } from "@/modules/shop/infrastructure/drizzle-shop-repository";
import { db } from "@/shared/infrastructure/db/client";

// Lớp presentation không import thẳng shared/infrastructure, nên guard và luật mật khẩu được đưa ra qua đây.
export { requireCurrentSession, requireProfile, requireSession } from "@/shared/infrastructure/auth/guard";
export { AccessDeniedError } from "@/shared/infrastructure/auth/access";
export { MIN_PASSWORD_LENGTH } from "@/shared/infrastructure/auth/password";

const authenticator = new BetterAuthAuthenticator();
export const signIn = new SignIn(authenticator);
export const signOut = new SignOut(authenticator);

const accounts = new DrizzleAccountRepository(db);
export const registerOwner = new RegisterOwner(new IpSignupLimiter(db), accounts, authenticator);
export const createStaff = new CreateStaff(accounts);
export const listStaff = new ListStaff(accounts);
export const setStaffActive = new SetStaffActive(accounts);
export const resetStaffPassword = new ResetStaffPassword(accounts);
export const changeOwnPassword = new ChangeOwnPassword(new ThrottledPasswordChanger(db));

export const getSubscription = new GetSubscription(new DrizzleShopRepository(db));

const cashbook = new DrizzleCashbookRepository(db);
export const setOpeningBalance = new SetOpeningBalance(cashbook);
export const getCashDay = new GetCashDay(cashbook);
export const listCashActors = new ListCashActors(cashbook);
export const recordManualEntry = new RecordManualEntry(cashbook);
export const reverseManualEntry = new ReverseManualEntry(cashbook);

// Khoá CCCD đọc lần đầu cần dùng rồi giữ lại; thiếu khoá thì chỉ thao tác có CCCD báo lỗi.
let cccdCipher: CccdCipher | undefined;
const lazyCccdCipher = () => (cccdCipher ??= CccdCipher.fromEnv());
const customerWriter = new DrizzleCustomerWriter(lazyCccdCipher);
const customerRepository = new DrizzleCustomerRepository(db, lazyCccdCipher);
export const editCustomer = new EditCustomer(customerRepository);
export const revealCccd = new RevealCccd(customerRepository);
const hashCccd = (shopId: string, cccd: string) => lazyCccdCipher().hash(shopId, cccd);
const contracts = new DrizzleContractRepository(db, customerWriter, appendCashEntries, hashCccd);
export const createContract = new CreateContract(contracts);
export const listContracts = new ListContracts(contracts);
export const listDueContracts = new ListDueContracts(contracts);
export const getContractDetail = new GetContractDetail(contracts);
export const payInterest = new PayInterest(contracts);
export const redeemContract = new RedeemContract(contracts);
export const changePrincipal = new ChangePrincipal(contracts);
export const extendContract = new ExtendContract(contracts);
export const reverseOperation = new ReverseOperation(contracts);
export const deleteContract = new DeleteContract(contracts);
export const editContract = new EditContract(contracts);

export const getDashboardStats = new GetDashboardStats(new DrizzleDashboardStats(db));
export const listCustomers = new ListCustomers(
  new DrizzleCustomerDirectory(db, hashCccd),
);
export const getCustomerDetail = new GetCustomerDetail(new DrizzleCustomerProfile(db));
export const getCashReport = new GetCashReport(new DrizzleCashReport(db));
export const getContractReport = new GetContractReport(new DrizzleContractReport(db));
