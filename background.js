// cnki-Scholar 后台脚本 - 处理跨域请求和文件下载
chrome.runtime.onInstalled.addListener(() => {
  console.log('[cnki-Scholar] 插件已安装/更新 v1.3');
});

// 下载历史记录，避免重复下载
const downloadHistory = new Set();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 处理跨域数据请求（Gitee期刊数据）
  if (request.url) {
    const maxRetries = request.retry || 3;
    let attempts = 0;

    function attemptFetch() {
      attempts++;
      console.log(`[cnki-Scholar] 第${attempts}次请求: ${request.url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      fetch(request.url, { signal: controller.signal })
        .then(response => {
          clearTimeout(timeoutId);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          return response.json();
        })
        .then(data => {
          console.log(`[cnki-Scholar] 数据获取成功，共${data.length}条`);
          sendResponse({ data });
        })
        .catch(error => {
          clearTimeout(timeoutId);
          console.error(`[cnki-Scholar] 第${attempts}次请求失败:`, error.message);
          if (attempts < maxRetries) {
            setTimeout(attemptFetch, 1000);
          } else {
            sendResponse({ error: `${attempts}次请求均失败: ${error.message}` });
          }
        });
    }

    attemptFetch();
    return true;
  }

  // 处理文件下载请求
  if (request.action === 'download') {
    const { url, filename } = request;

    // 去重检查
    if (downloadHistory.has(url)) {
      sendResponse({ skipped: true, reason: '已下载' });
      return true;
    }

    chrome.downloads.download({
      url: url,
      filename: filename || undefined,
      conflictAction: 'uniquify',
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('[cnki-Scholar] 下载失败:', chrome.runtime.lastError.message);
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        downloadHistory.add(url);
        console.log('[cnki-Scholar] 下载已启动, ID:', downloadId);
        sendResponse({ downloadId });
      }
    });
    return true;
  }

  // 清除下载历史
  if (request.action === 'clearDownloadHistory') {
    downloadHistory.clear();
    sendResponse({ ok: true });
    return true;
  }
});

// 监听下载状态变化，向content script通知
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state) {
    // 通过广播通知所有tab
    chrome.tabs.query({ url: "*://*.cnki.net/*" }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'downloadStateChanged',
          downloadId: delta.id,
          state: delta.state.current
        }).catch(() => {});
      });
    });
  }
});
