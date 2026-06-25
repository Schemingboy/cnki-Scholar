// cnki-Scholar 后台脚本 - 处理跨域请求和文件下载
chrome.runtime.onInstalled.addListener(() => {
  console.log('[cnki-Scholar] 插件已安装/更新 v1.3');
});

// 下载历史记录，避免重复下载
const DOWNLOAD_HISTORY_KEY = 'cnkiScholarDownloadHistory';
const downloadHistory = new Set();
const activeDownloads = new Map();

const historyReady = new Promise(resolve => chrome.storage.local.get({ [DOWNLOAD_HISTORY_KEY]: [] }, (result) => {
  const history = result[DOWNLOAD_HISTORY_KEY] || [];
  history.forEach(item => downloadHistory.add(item));
  resolve();
}));

function saveDownloadHistory() {
  chrome.storage.local.set({
    [DOWNLOAD_HISTORY_KEY]: Array.from(downloadHistory).slice(-5000)
  });
}

function buildHistoryKeys({ url, filename, articleKey }) {
  return [articleKey, filename, url].filter(Boolean);
}

function normalizePath(text) {
  return (text || '').replace(/\\/g, '/').toLowerCase();
}

function basename(path) {
  return normalizePath(path).split('/').pop() || '';
}

function checkDownloadedFiles(items) {
  return new Promise(resolve => {
    chrome.downloads.search({}, downloads => {
      const records = Array.isArray(downloads) ? downloads : [];
      const results = (items || []).map(item => {
        const expectedPath = normalizePath(item.expectedPath);
        const expectedName = basename(expectedPath);
        const expectedSubdir = normalizePath(item.expectedSubdir);
        const historyKeys = buildHistoryKeys(item);
        const inHistory = historyKeys.some(key => downloadHistory.has(key));

        const matches = records.filter(record => {
          const file = normalizePath(record.filename);
          return expectedName && basename(file) === expectedName && record.exists !== false;
        });

        const inTargetDir = matches.find(record => normalizePath(record.filename).includes(`/${expectedSubdir}/`));
        if (inTargetDir) {
          return {
            id: item.id,
            taskId: item.taskId,
            status: 'downloaded',
            filename: inTargetDir.filename,
            inHistory
          };
        }

        if (matches.length > 0) {
          return {
            id: item.id,
            taskId: item.taskId,
            status: 'wrong-location',
            filename: matches[0].filename,
            inHistory
          };
        }

        return {
          id: item.id,
          taskId: item.taskId,
          status: inHistory ? 'record-only' : 'missing',
          inHistory
        };
      });

      resolve({ results });
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 处理跨域数据请求（Gitee期刊数据）
  if (request.url && !request.action) {
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
    historyReady.then(() => {
      const { url, filename, articleKey } = request;
      const historyKeys = buildHistoryKeys({ url, filename, articleKey });

      // 去重检查
      if (historyKeys.some(key => downloadHistory.has(key))) {
        sendResponse({ skipped: true, reason: '已下载' });
        return;
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
          activeDownloads.set(downloadId, { url, filename, articleKey, historyKeys });
          console.log('[cnki-Scholar] 下载已启动, ID:', downloadId);
          sendResponse({ downloadId, filename });
        }
      });
    });
    return true;
  }

  if (request.action === 'checkDownloadedFiles') {
    historyReady
      .then(() => checkDownloadedFiles(request.items))
      .then(result => sendResponse(result));
    return true;
  }

  // 清除下载历史
  if (request.action === 'clearDownloadHistory') {
    historyReady.then(() => {
      downloadHistory.clear();
      chrome.storage.local.remove(DOWNLOAD_HISTORY_KEY, () => sendResponse({ ok: true }));
    });
    return true;
  }
});

// 监听下载状态变化，向content script通知
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state) {
    const active = activeDownloads.get(delta.id);
    if (active && delta.state.current === 'complete') {
      active.historyKeys.forEach(key => downloadHistory.add(key));
      saveDownloadHistory();
      activeDownloads.delete(delta.id);
    } else if (active && delta.state.current === 'interrupted') {
      activeDownloads.delete(delta.id);
    }

    // 通过广播通知所有tab
    chrome.tabs.query({ url: "*://*.cnki.net/*" }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'downloadStateChanged',
          downloadId: delta.id,
          state: delta.state.current,
          filename: active?.filename,
          articleKey: active?.articleKey
        }).catch(() => {});
      });
    });
  }
});
