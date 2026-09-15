let theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
try {
  const saved = localStorage.getItem('balju-theme');
  if (saved === 'light' || saved === 'dark') theme = saved;
} catch {
  // 저장소를 사용할 수 없는 브라우저에서도 테마 전환은 동작합니다.
}
document.documentElement.dataset.theme = theme;
