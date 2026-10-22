"use client";

import { useActionState } from "react";
import { revealCccdAction, type RevealCccdState } from "./actions";

const initialState: RevealCccdState = { error: null, cccd: null };

/** Số CCCD đã che; chủ tiệm bấm "Hiện số đầy đủ" thì server ghi nhật ký rồi trả số đầy đủ (core-spec mục 2). */
export function CccdReveal({
  customerId,
  masked,
  canReveal,
}: {
  customerId: string;
  masked: string;
  canReveal: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    revealCccdAction,
    initialState,
  );
  if (state.cccd) return <span className="num">{state.cccd}</span>;
  return (
    <>
      <span className="num">{masked}</span>
      {canReveal && (
        <form action={formAction} className="inline">
          <input type="hidden" name="customerId" value={customerId} />
          <button
            type="submit"
            className="ml-2 text-xs text-teal-700 hover:underline"
            title="Chỉ chủ tiệm, có ghi nhật ký"
            disabled={pending}
          >
            Hiện số đầy đủ
          </button>
        </form>
      )}
      {state.error && (
        <span role="alert" className="block text-xs text-red-700">
          {state.error}
        </span>
      )}
    </>
  );
}
