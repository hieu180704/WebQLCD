// Mockup TP83 — dựng sidebar + topbar dùng chung cho các trang quản lý.
// Trang khai báo <body data-page="..."> và <div id="app-shell"> bọc nội dung.
(function () {
  const ICON = {
    home: '<path d="M3 10.5 12 3l9 7.5V21H3z"/><path d="M9 21v-6h6v6"/>',
    pawn: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/>',
    installment: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
    customer: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    report: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    staff: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M22 20a7 7 0 0 0-4-6.3"/>',
    backup: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  };
  const svg = (name, cls = 'icon') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
  window.tpIcon = svg;

  const NAV = [
    { id: 'dashboard', label: 'Tổng quan', href: 'dashboard.html', icon: 'home' },
    { id: 'pawn', label: 'Cầm đồ & Tín chấp', href: 'cam-do.html', icon: 'pawn' },
    { id: 'installment', label: 'Trả góp', href: 'tra-gop.html', icon: 'installment' },
    { id: 'cash', label: 'Quỹ két & Thu chi', href: 'quy-ket.html', icon: 'cash' },
    { id: 'customer', label: 'Khách hàng', href: 'khach-hang.html', icon: 'customer' },
    { id: 'report', label: 'Báo cáo', href: 'bao-cao.html', icon: 'report' },
    { id: 'backup', label: 'Sao lưu & Xuất Excel', href: 'sao-luu.html', icon: 'backup' },
    { id: 'staff', label: 'Nhân viên', href: 'nhan-vien.html', icon: 'staff' },
    { id: 'settings', label: 'Cài đặt cửa hàng', href: 'cai-dat.html', icon: 'settings' },
  ];

  const page = document.body.dataset.page;
  const shell = document.getElementById('app-shell');
  const content = shell.innerHTML;

  const nav = NAV.map(n =>
    `<a href="${n.href}" class="nav-link ${n.id === page ? 'active' : ''}" ${n.href === '#' ? 'title="Chưa có mockup"' : ''}>${svg(n.icon)}<span>${n.label}</span></a>`
  ).join('');

  shell.innerHTML = `
  <div class="min-h-screen flex flex-col lg:flex-row">
    <div id="backdrop" class="hidden fixed inset-0 z-30 bg-slate-900/40 lg:hidden"></div>
    <aside id="sidebar" class="hidden fixed inset-y-0 left-0 z-40 w-72 shadow-xl lg:shadow-none lg:flex lg:flex-col lg:w-64 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen bg-white border-r border-slate-200 overflow-y-auto">
      <div class="h-16 px-5 flex items-center gap-3 border-b border-slate-200">
        <button id="menu-close" class="btn btn-outline lg:hidden !px-2.5 order-last ml-auto" aria-label="Đóng menu">✕</button>
        <div class="w-9 h-9 rounded-lg bg-teal-700 text-white grid place-items-center text-xs font-bold">LOGO</div>
        <div>
          <div class="font-bold leading-tight">TP83</div>
          <div class="text-xs text-slate-500 leading-tight">Quản lý cầm đồ</div>
        </div>
      </div>
      <nav class="flex-1 p-3 flex flex-col gap-1" aria-label="Menu chính">${nav}</nav>
      <div class="p-4 border-t border-slate-200 text-sm">
        <div class="rounded-lg bg-amber-50 text-amber-800 p-3">
          <div class="font-semibold">Dùng thử: còn 5 ngày</div>
          <div class="text-xs mt-1">Hết hạn 24/10/2026. Sau đó tài khoản chỉ xem được dữ liệu.</div>
          <a href="#" class="text-xs font-semibold underline mt-2 inline-block">Gia hạn gói</a>
        </div>
      </div>
    </aside>
    <div class="flex-1 min-w-0 flex flex-col">
      <header class="h-16 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center gap-3">
        <button id="menu-btn" class="btn btn-outline lg:hidden !px-2.5" aria-label="Mở menu" aria-expanded="false">${svg('menu')}</button>
        <div class="min-w-0">
          <div class="text-xs text-slate-500">Cửa hàng</div>
          <div class="font-semibold truncate">Cầm đồ Minh Phát</div>
        </div>
        <div class="ml-auto flex items-center gap-3">
          <div class="hidden sm:block text-right">
            <div class="text-sm font-medium">Trần Văn A</div>
            <div class="text-xs text-slate-500">Chủ tiệm</div>
          </div>
          <a href="index.html" class="btn btn-outline !px-2.5" aria-label="Đăng xuất">${svg('logout')}</a>
        </div>
      </header>
      <main class="flex-1 p-4 lg:p-6">${content}</main>
    </div>
  </div>`;

  const btn = document.getElementById('menu-btn');
  const side = document.getElementById('sidebar');
  const backdrop = document.getElementById('backdrop');
  function setMenu(open) {
    side.classList.toggle('hidden', !open);
    side.classList.toggle('flex', open);
    side.classList.toggle('flex-col', open);
    backdrop.classList.toggle('hidden', !open);
    btn.setAttribute('aria-expanded', String(open));
  }
  btn.addEventListener('click', () => setMenu(true));
  document.getElementById('menu-close').addEventListener('click', () => setMenu(false));
  backdrop.addEventListener('click', () => setMenu(false));
})();

// Định dạng tiền VND, dùng chung cho các trang
window.vnd = n => new Intl.NumberFormat('vi-VN').format(Math.round(n));

// Nút có data-open="<id dialog>" mở hộp thoại tương ứng
document.addEventListener('click', e => {
  const b = e.target.closest('[data-open]');
  if (b) { e.preventDefault(); document.getElementById(b.dataset.open).showModal(); }
});
