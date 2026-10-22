import { checkInfoEdit } from "../domain/contract";
import type { Actor, ContractRepository, EditableInfo } from "./ports";

export type EditContractInput = {
  contractId: string;
  /** Giá trị người sửa đang thấy; DB đã khác (người khác vừa sửa) thì từ chối. */
  expected: EditableInfo;
  info: EditableInfo;
};

export type EditContractError = "not_found" | "deleted" | "stale" | "asset_required";

export type EditContractResult = { ok: true; changed: (keyof EditableInfo)[] } | { ok: false; error: EditContractError };

/** Sửa thông tin hồ sơ hợp đồng cầm đồ/tín chấp: không sinh giao dịch, ghi audit `edit`. */
export class EditContract {
  constructor(private readonly contracts: ContractRepository) {}

  async execute(actor: Actor, input: EditContractInput): Promise<EditContractResult> {
    const contract = await this.contracts.findDetail(actor.shopId, input.contractId);
    if (!contract) return { ok: false, error: "not_found" };
    if (contract.deleted) return { ok: false, error: "deleted" };
    if (contract.assetName !== input.expected.assetName || contract.note !== input.expected.note) return { ok: false, error: "stale" };
    const violation = checkInfoEdit(contract.kind, input.info.assetName);
    if (violation) return { ok: false, error: violation };

    const changed = (["assetName", "note"] as const).filter((field) => input.info[field] !== contract[field]);
    if (changed.length === 0) return { ok: true, changed };
    const saved = await this.contracts.recordEdit(actor, { contractId: input.contractId, expected: input.expected, info: input.info, changed });
    return saved ? { ok: true, changed } : { ok: false, error: "stale" };
  }
}
