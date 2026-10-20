import { signOutAction } from "./actions";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button type="submit" className="btn btn-outline !px-2.5" aria-label="Đăng xuất" title="Đăng xuất">
        <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
      </button>
    </form>
  );
}
