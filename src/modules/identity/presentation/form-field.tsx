import type { ComponentProps } from "react";

export function FormField({ label, id, className = "", ...props }: ComponentProps<"input"> & { label: string; id: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id} className={`input ${className}`} {...props} />
    </div>
  );
}
