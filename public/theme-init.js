/* ตั้งธีมก่อนวาดหน้า (กันจอกะพริบมืด→สว่าง) · ไฟล์แยกเพราะ CSP ไม่อนุญาตสคริปต์ในหน้า
   ทำงานเดียวกับ applyTheme ใน src/app/theme.ts (มีเทสต์ล็อกให้ตรงกัน) · ไม่แตะข้อมูลการเงิน */
(function () {
  try {
    var choice = null;
    try {
      choice = window.localStorage.getItem('mb.theme');
    } catch (e) {}
    var root = document.documentElement;
    if (choice === 'dark' || choice === 'light') root.setAttribute('data-theme', choice);
    var light = choice === 'light' || (choice !== 'dark' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', light ? '#eef1f8' : '#07080d');
  } catch (e) {}
})();
