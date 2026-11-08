const api = window.sunrise;

if (!api) {
  // 预加载脚本失败时，页面仍然给出可读的错误，而不是整页空白。
  document.addEventListener('DOMContentLoaded', () => {
    document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:#fff;background:#000;height:100vh">启动器预加载失败，请重新打开“旭日东升”。</div>';
  });
}

export default api;
