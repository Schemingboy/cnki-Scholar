// cnki-batch-download 后台脚本 - 处理跨域请求和文件下载
chrome.runtime.onInstalled.addListener(() => {
  console.log('[cnki-batch-download] 插件已安装/更新 v1.3');
});

// 下载历史记录，避免重复下载
const DOWNLOAD_HISTORY_KEY = 'cnkiScholarDownloadHistory';
const downloadHistory = new Set();
const historyReady = new Promise(resolve => chrome.storage.local.get({ [DOWNLOAD_HISTORY_KEY]: [] }, (result) => {
  const history = result[DOWNLOAD_HISTORY_KEY] || [];
  history.forEach(item => downloadHistory.add(item));
  resolve();
}));

function buildHistoryKeys({ url, filename, articleKey }) {
  return [articleKey, filename, url].filter(Boolean);
}

function normalizePath(text) {
  return (text || '').replace(/\\/g, '/').toLowerCase();
}

function basename(path) {
  return normalizePath(path).split('/').pop() || '';
}

function normalizeTitleForFile(text) {
  return normalizePath(text)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\.+$/g, '')
    .slice(0, 120)
    .trim();
}

function checkDownloadedFiles(items) {
  return new Promise(resolve => {
    chrome.downloads.search({}, downloads => {
      const records = Array.isArray(downloads) ? downloads : [];
      const results = (items || []).map(item => {
        const expectedPath = normalizePath(item.expectedPath);
        const expectedName = basename(expectedPath);
        const title = normalizeTitleForFile(item.title);
        const historyKeys = buildHistoryKeys(item);
        const inHistory = historyKeys.some(key => downloadHistory.has(key));

        const matches = records.filter(record => {
          const file = normalizePath(record.filename);
          if (record.exists === false || !/\.pdf$/i.test(file)) return false;
          const fileName = basename(file);
          return (
            (expectedName && fileName === expectedName) ||
            (title && fileName.includes(title))
          );
        });

        if (matches.length > 0) {
          return {
            id: item.id,
            taskId: item.taskId,
            status: 'downloaded',
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
      console.log(`[cnki-batch-download] 第${attempts}次请求: ${request.url}`);

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
          console.log(`[cnki-batch-download] 数据获取成功，共${data.length}条`);
          sendResponse({ data });
        })
        .catch(error => {
          clearTimeout(timeoutId);
          console.error(`[cnki-batch-download] 第${attempts}次请求失败:`, error.message);
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
