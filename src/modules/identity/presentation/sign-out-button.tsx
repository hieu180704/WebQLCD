import { Button } from "@/shared/ui/button";
import { signOutAction } from "./actions";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="outline">
        Đăng xuất
      </Button>
    </form>
  );
}
