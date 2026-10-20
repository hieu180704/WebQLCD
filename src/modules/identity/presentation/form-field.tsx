import type { ComponentProps } from "react";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

export function FormField({ label, id, ...props }: ComponentProps<typeof Input> & { label: string; id: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} {...props} />
    </div>
  );
}
