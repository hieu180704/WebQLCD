"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type StatusContext = { message: string | null; report: (message: string | null) => void };

const Status = createContext<StatusContext>({ message: null, report: () => {} });

/** Thông báo chung của các hộp thoại trên trang quỹ két: chỉ giữ kết quả của thao tác mới nhất. */
export function CashStatus({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  return <Status value={{ message, report: setMessage }}>{children}</Status>;
}

/** Chỗ hiện thông báo; đặt ở đâu trong `CashStatus` cũng được. */
export function CashStatusMessage() {
  const { message } = useContext(Status);
  if (!message) return null;
  return (
    <p role="status" className="mt-4 rounded-lg bg-emerald-50 text-emerald-800 px-4 py-3 text-sm">
      {message}
    </p>
  );
}

export const useReportCashStatus = () => useContext(Status).report;
