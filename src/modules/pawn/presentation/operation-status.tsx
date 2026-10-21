"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

const ReportStatus = createContext<(message: string | null) => void>(() => {});

/** Vùng thông báo chung của các hộp thoại thao tác: chỉ hiện kết quả của thao tác mới nhất. */
export function OperationStatus({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <ReportStatus value={setMessage}>
      {children}
      {message && (
        <p role="status" className="basis-full rounded-lg bg-emerald-50 text-emerald-800 px-4 py-3 text-sm">
          {message}
        </p>
      )}
    </ReportStatus>
  );
}

export const useReportStatus = () => useContext(ReportStatus);
