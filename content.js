// ============================================================
// cnki-Scholar v1.3 — 知网增强插件 (重构版)
// 功能: PDF下载 | 摘要悬停 | 期刊标签 | 批量下载
// ============================================================

// ========== 常量 ==========

const SELECTORS = {
  // 文章链接（搜索结果页）
  articleLinks: [
    '#gridTable > div > div > div > table > tbody > tr > td.name > a.fz14',
    '#gridTable > div > div > div > table > tbody > tr > td.name > div > a.fz14',
    '.result-table-list tbody tr td.name a',
  ],
  // 期刊来源单元格（搜索结果页）
  sourceCells: 'td.source, td.publishing, .result-table-list td.source, .s-main td.source, td[data-key=source]',
  // 期刊名（详情页）
  detailJournalName: '.top-tip span a',
  detailHost: '.wx-tit',
  // 翻页栏
  pagesDiv: '#briefBox > div:nth-child(2) > div > div.pages',
  // 关键词（详情页多种文献类型）
  keywords: [
    'body > div.wrapper > div.main > div.container > div > div:nth-child(3) > div:nth-child(4) > p.keywords',
    'body > div.wrapper > div.main > div.container > div > div > div:nth-child(3) > div.brief > div:nth-child(4) > p',
    'body > div.wrapper > div.main > div.container > div > div.doc-top > div:nth-child(3) > div.brief > div:nth-child(4) > p',
    'body > div.wrapper > div.main > div.container > div.doc > div > div:nth-child(3) > div.brief > div:nth-child(3) > p',
  ],
};

// 期刊标签配色映射
const TAG_COLORS = {
  cas:   { '1': '#F44336', '2': '#FF9800', '3': '#FFC107', '4': '#2196F3' },
  jcr:   { 'Q1': '#F44336', 'Q2': '#FF9800', 'Q3': '#FFC107', 'Q4': '#2196F3' },
  wjci:  { 'Q1': '#4CAF50', 'Q2': '#2196F3', 'Q3': '#FFC107', 'Q4': '#F44336' },
  tag:   { '核心': '#F44336', '扩展': '#FF9800', 'EI': '#FF7043', 'SCI': '#4CAF50', 'CSSCI': '#9C27B0' },
  wos:   '#009688',
  top:   'rgba(156, 39, 176, 0.8)',
  impact:'rgba(156, 39, 176, 0.8)',
  rank:  'rgba(156, 39, 176, 0.8)',
};

// 关键词标签配色
const KEYWORD_COLORS = [
  ['#f0f8ff', '#6eb6ff'],  // 淡蓝
  ['#f5fff0', '#a3d899'],  // 淡绿
  ['#fff8f0', '#ffbe7d'],  // 淡橙
  ['#fff5fa', '#ffa6d2'],  // 淡粉
  ['#faf5ff', '#c59df9'],  // 淡紫
];

// 默认期刊数据（离线回退）
const DEFAULT_JOURNALS_DATA = [
  { title: "计算机学报",   tags: ["北大核心","EI","CSCD"],    impactFactor: "2.456", "中科院": "2", WOS: "SCIE" },
  { title: "软件学报",     tags: ["北大核心","EI","CSCD"],    impactFactor: "1.892", "中科院": "2", WOS: "SCIE" },
  { title: "自动化学报",   tags: ["北大核心","EI","CSCD"],    impactFactor: "3.125", "中科院": "1", WOS: "SCIE" },
  { title: "中国科学",     tags: ["北大核心","CSCD"],         impactFactor: "4.123", "中科院": "1", WOS: "SCIE" },
  { title: "科学通报",     tags: ["北大核心","CSCD"],         impactFactor: "3.456", "中科院": "1", WOS: "SCIE" },
  { title: "管理世界",     tags: ["北大核心","CSSCI"],        impactFactor: "35.785" },
  { title: "经济研究",     tags: ["北大核心","CSSCI"],        impactFactor: "20.332" },
  { title: "中国工业经济", tags: ["北大核心","CSSCI"],        impactFactor: "32.332" },
  { title: "社会学研究",   tags: ["北大核心","CSSCI"],        impactFactor: "8.5" },
  { title: "法学研究",     tags: ["北大核心","CSSCI"],        impactFactor: "7.2" },
  { title: "教育研究",     tags: ["北大核心","CSSCI"],        impactFactor: "5.8" },
  { title: "心理科学进展", tags: ["北大核心","CSSCI","CSCD"], impactFactor: "3.5" },
  { title: "图书情报工作", tags: ["北大核心","CSSCI"],        impactFactor: "2.8" },
];

// 期刊数据缓存
const journalCache = {
  data: null,
  lastFetch: 0,
  CACHE_DURATION: 3600000, // 1小时
};

// ========== 工具函数 ==========

const DEFAULT_DOWNLOAD_SUBDIR = 'CNKI';
const SETTINGS_STORAGE_KEY = 'cnkiScholarSettings';
const CAPTCHA_REQUIRED = '__CNKI_CAPTCHA_REQUIRED__';
const DEFAULT_DELAY_SECONDS = 8;
const MIN_DELAY_SECONDS = 6;
const pendingDownloads = new Map();

function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function sanitizeFilename(text) {
  const name = normalizeText(text)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\.+$/g, '')
    .slice(0, 120)
    .trim();
  return name || 'cnki-paper';
}

function normalizeDownloadSubdir(input) {
  let value = normalizeText(input).replace(/\\/g, '/');

  // If the user pastes H:/CNKI, keep the usable relative part.
  value = value.replace(/^[a-zA-Z]:\//, '');
  value = value.replace(/^\/+|\/+$/g, '');

  const parts = value
    .split('/')
    .map(part => sanitizeFilename(part))
    .filter(part => part && part !== '.' && part !== '..');

  return parts.join('/') || DEFAULT_DOWNLOAD_SUBDIR;
}

function getStoredSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(
      { [SETTINGS_STORAGE_KEY]: { downloadSubdir: DEFAULT_DOWNLOAD_SUBDIR } },
      result => {
        const settings = result?.[SETTINGS_STORAGE_KEY] || {};
        resolve({
          downloadSubdir: normalizeDownloadSubdir(settings.downloadSubdir),
        });
      }
    );
  });
}

function saveDownloadSubdir(input) {
  const downloadSubdir = normalizeDownloadSubdir(input);
  return new Promise(resolve => {
    chrome.storage.local.set(
      { [SETTINGS_STORAGE_KEY]: { downloadSubdir } },
      () => resolve(downloadSubdir)
    );
  });
}

function getDownloadExtension(url) {
  const lower = (url || '').toLowerCase();
  if (lower.includes('caj')) return '.caj';
  if (lower.includes('pdf')) return '.pdf';
  return '.pdf';
}

function buildDownloadFilename(title, url, subdir = DEFAULT_DOWNLOAD_SUBDIR) {
  return `${normalizeDownloadSubdir(subdir)}/${sanitizeFilename(title)}${getDownloadExtension(url)}`;
}

function getExpectedDownloadPaths(title, subdir = DEFAULT_DOWNLOAD_SUBDIR) {
  const safeTitle = sanitizeFilename(title);
  const safeSubdir = normalizeDownloadSubdir(subdir);
  return ['.pdf', '.caj'].map(ext => `${safeSubdir}/${safeTitle}${ext}`);
}

function buildArticleKey(articleUrl, title) {
  try {
    const url = new URL(articleUrl, window.location.href);
    url.hash = '';
    return `${url.origin}${url.pathname}${url.search}|${sanitizeFilename(title).toLowerCase()}`;
  } catch {
    return `${normalizeText(articleUrl)}|${sanitizeFilename(title).toLowerCase()}`;
  }
}

function isVerificationPage(response, text) {
  const url = (response?.url || '').toLowerCase();
  const head = (text || '').slice(0, 4000);
  return (
    url.includes('checkcode') ||
    url.includes('verify') ||
    /验证码|安全验证|访问验证|人机验证|拖动滑块|滑块验证/.test(head)
  );
}

function isVerificationUrl(url) {
  const lower = (url || '').toLowerCase();
  return lower.includes('checkcode') || lower.includes('captcha') || lower.includes('verify');
}

function normalizeDelaySeconds(input) {
  const value = parseInt(input, 10);
  if (!Number.isFinite(value)) return DEFAULT_DELAY_SECONDS;
  return Math.max(MIN_DELAY_SECONDS, value);
}

function escapeHtml(text) {
  return normalizeText(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 三级期刊名匹配：精确 → 中英文变体 → 去括号模糊
 */
function findJournal(name, data) {
  if (!name || !data) return null;
  const lower = name.toLowerCase();

  // 第一级：精确匹配
  let found = data.find(j => j.title.toLowerCase() === lower);
  if (found) return found;

  // 第二级：中英文变体
  found = data.find(j => j.title.toLowerCase() === `${lower}(中英文)`);
  if (found) return found;

  // 第三级：去括号模糊匹配
  const base = name.replace(/[（）()]/g, '').trim().toLowerCase();
  if (base) {
    found = data.find(j => j.title.toLowerCase().includes(base));
  }
  return found || null;
}

/**
 * 创建单个标签 DOM 元素
 */
function createTagEl(text, bgColor, extraStyle = {}) {
  const el = document.createElement('span');
  el.className = 'journal-tag';
  el.textContent = text;
  Object.assign(el.style, {
    backgroundColor: bgColor,
    ...extraStyle,
  });
  return el;
}

/**
 * 根据 journalInfo 渲染所有标签到容器
 */
function renderJournalTags(journalInfo, tagContainer) {
  if (!journalInfo) return;

  // 中文影响因子
  if (journalInfo.impactFactor && journalInfo.impactFactor !== 'N/A') {
    tagContainer.appendChild(createTagEl(`IF: ${journalInfo.impactFactor}`, TAG_COLORS.impact));
  }

  // JCR 影响因子
  if (journalInfo.JCR_IF && journalInfo.JCR_IF !== 'N/A') {
    tagContainer.appendChild(createTagEl(`JCR IF: ${journalInfo.JCR_IF}`, TAG_COLORS.impact));
  }

  // 复合影响因子
  if (journalInfo.compositeImpactFactor && journalInfo.compositeImpactFactor !== 'N/A') {
    tagContainer.appendChild(createTagEl(`复合IF: ${journalInfo.compositeImpactFactor}`, TAG_COLORS.impact));
  }

  // 排名
  if (journalInfo.CR && journalInfo.CR !== 'N/A') {
    tagContainer.appendChild(createTagEl(`排名: ${journalInfo.CR}`, TAG_COLORS.rank));
  }

  // 中科院分区
  if (journalInfo['中科院']) {
    const color = TAG_COLORS.cas[journalInfo['中科院']] || '#2196F3';
    tagContainer.appendChild(createTagEl(`中科院 ${journalInfo['中科院']}区`, color));
  }

  // TOP
  if (journalInfo.TOP === 'T') {
    tagContainer.appendChild(createTagEl('Top', TAG_COLORS.top));
  }

  // JCR 分区
  if (journalInfo.IF_Quartile && journalInfo.IF_Quartile !== 'N/A') {
    const color = TAG_COLORS.jcr[journalInfo.IF_Quartile] || '#2196F3';
    tagContainer.appendChild(createTagEl(`JCR ${journalInfo.IF_Quartile}`, color));
  }

  // WOS
  if (journalInfo.WOS && journalInfo.WOS !== 'N/A') {
    journalInfo.WOS.split(';').forEach(w => {
      const val = w.trim();
      if (val) tagContainer.appendChild(createTagEl(val, TAG_COLORS.wos));
    });
  }

  // WJCI
  if (journalInfo.wjci && journalInfo.wjci !== 'N/A') {
    const level = journalInfo.wjci.substring(0, 2).toUpperCase();
    const color = TAG_COLORS.wjci[level] || '#5C6BC0';
    tagContainer.appendChild(createTagEl(`WJCI ${journalInfo.wjci}`, color));
  }

  // tags（北大核心、CSSCI、CSCD 等）
  if (journalInfo.tags && journalInfo.tags.length > 0) {
    // CSSCI 排前面
    const sorted = [...journalInfo.tags].sort((a, b) => {
      if (a.includes('CSSCI')) return -1;
      if (b.includes('CSSCI')) return 1;
      return 0;
    });
    sorted.forEach(tagText => {
      if (!tagText || tagText === 'N/A') return;
      let bgColor = '#5C6BC0';
      for (const [key, color] of Object.entries(TAG_COLORS.tag)) {
        if (tagText.includes(key)) { bgColor = color; break; }
      }
      tagContainer.appendChild(createTagEl(tagText, bgColor));
    });
  }
}

/**
 * 获取所有可见文章链接
 */
function getArticleLinks() {
  return document.querySelectorAll(SELECTORS.articleLinks);
}

// ========== PDF 单篇下载 ==========

async function addPdfDownloadButtons() {
  const articleLinks = getArticleLinks();

  for (const link of articleLinks) {
    const row = link.closest('tr');
    if (!row || row.querySelector('.pdf-download-btn')) continue;

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'pdf-download-btn';
    downloadBtn.textContent = '下载';

    const nameCell = row.querySelector('td.name');
    if (!nameCell) continue;

    // 创建 flex 容器
    const container = document.createElement('div');
    Object.assign(container.style, {
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
    });

    const titleLink = nameCell.querySelector('a');
    if (titleLink) {
      Object.assign(titleLink.style, {
        textAlign: 'left',
        whiteSpace: 'normal',
        wordBreak: 'break-word',
        display: 'inline',
        flex: '1',
        minWidth: '0',
        fontSize: '14px',
        lineHeight: '1.2',
      });
    }

    // 标题+关键词包装
    const titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'display:flex;flex-direction:column;flex:1;min-width:0;';

    // 关键词容器
    const keywordsContainer = document.createElement('div');
    keywordsContainer.className = 'keywords-container';
    keywordsContainer.style.cssText = 'display:flex;flex-wrap:wrap;margin-top:4px;width:100%;';

    // 组装
    nameCell.innerHTML = '';
    container.appendChild(downloadBtn);
    if (titleLink) {
      titleWrap.appendChild(titleLink);
    }
    titleWrap.appendChild(keywordsContainer);
    container.appendChild(titleWrap);
    nameCell.appendChild(container);

    // 异步获取关键词
    fetchKeywords(link.href, keywordsContainer);

    // 下载事件
    downloadBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      downloadBtn.textContent = '获取中...';
      downloadBtn.disabled = true;

      try {
        const pdfUrl = await fetchPdfUrl(link.href, row);
        if (pdfUrl) {
          const settings = await getStoredSettings();
          const title = titleLink?.textContent;
          const filename = buildDownloadFilename(title, pdfUrl, settings.downloadSubdir);

          // 使用 chrome.downloads API（通过 background.js）
          const result = await downloadPdf(pdfUrl, filename, buildArticleKey(link.href, title));
          if (result?.skipped) {
            alert(`已下载过这篇文章：\n${filename}`);
          } else if (result?.downloadId) {
            await waitForDownload(result.downloadId);
          }
        } else {
          alert('无法获取PDF下载链接');
        }
      } catch (error) {
        console.error('[cnki-Scholar] 获取PDF链接失败:', error);
        alert('获取PDF链接失败: ' + error.message);
      } finally {
        downloadBtn.textContent = '下载';
        downloadBtn.disabled = false;
      }
    });
  }
}

/**
 * 通过 background.js 下载 PDF
 */
function downloadPdf(url, filename, articleKey) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'download', url, filename, articleKey },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
        } else if (response?.skipped) {
          resolve({ skipped: true });
        } else {
          resolve({ downloadId: response.downloadId, filename: response.filename || filename });
        }
      }
    );
  });
}

function waitForDownload(downloadId, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingDownloads.delete(downloadId);
      reject(new Error('下载超时'));
    }, timeoutMs);

    pendingDownloads.set(downloadId, {
      resolve: (message) => {
        clearTimeout(timeoutId);
        resolve(message);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    });
  });
}

function checkDownloadedFiles(items) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'checkDownloadedFiles', items },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response?.results || []);
      }
    );
  });
}

/**
 * 获取文章页面的 PDF/CAJ 下载链接
 */
async function fetchPdfUrl(articleUrl, row) {
  try {
    const response = await fetch(articleUrl, { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    if (isVerificationPage(response, text)) {
      throw new Error(CAPTCHA_REQUIRED);
    }

    const doc = new DOMParser().parseFromString(text, 'text/html');

    // PDF/CAJ 下载按钮
    const isThesis = row?.querySelector('img[src*="thesis"]') || articleUrl.includes('CDMD');

    if (isThesis) {
      const thesisLink = doc.querySelector('.btn-dlcaj, .btn-dlpdf');
      if (thesisLink?.href) {
        try {
          const url = new URL(thesisLink.href, articleUrl);
          if (isVerificationUrl(url.href)) throw new Error(CAPTCHA_REQUIRED);
          if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
        } catch (error) {
          if (error?.message === CAPTCHA_REQUIRED) throw error;
        }
      }
    } else {
      const downloadBtns = doc.querySelectorAll('#pdfDown, #cajDown');
      let pdfLink = null, cajLink = null;
      for (const btn of downloadBtns) {
        if (!btn?.href) continue;
        try {
          const url = new URL(btn.href, articleUrl);
          if (isVerificationUrl(url.href)) throw new Error(CAPTCHA_REQUIRED);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
          const text = (btn.textContent || '').trim().toLowerCase();
          if (text.includes('pdf') && !pdfLink) pdfLink = url.href;
          else if (text.includes('caj') && !cajLink) cajLink = url.href;
        } catch (error) {
          if (error?.message === CAPTCHA_REQUIRED) throw error;
        }
      }
      if (pdfLink) return pdfLink;
      if (cajLink) return cajLink;
    }

    return null;
  } catch (error) {
    if (error?.message === CAPTCHA_REQUIRED) throw error;
    console.error(`[cnki-Scholar] fetchPdfUrl 失败 (${articleUrl}):`, error);
    return null;
  }
}

// ========== 关键词 ==========

async function fetchKeywords(articleUrl, container) {
  try {
    const response = await fetch(articleUrl, { credentials: 'include' });
    if (!response.ok) return;

    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');

    let keywordsEl = null;
    for (const sel of SELECTORS.keywords) {
      const el = doc.querySelector(sel);
      if (el && el.classList.contains('keywords')) { keywordsEl = el; break; }
    }
    if (!keywordsEl) return;

    const links = keywordsEl.querySelectorAll('a');
    links.forEach((link, i) => {
      const keyword = link.textContent.replace(/;$/, '').trim();
      if (!keyword) return;

      const [bg, fg] = KEYWORD_COLORS[i % KEYWORD_COLORS.length];
      const tag = document.createElement('a');
      tag.className = 'keyword-tag';
      tag.textContent = keyword;

      // 清理链接
      const rawHref = link.getAttribute('href');
      if (rawHref) tag.href = rawHref.replace(/`/g, '').trim();
      tag.target = '_blank';

      Object.assign(tag.style, {
        backgroundColor: bg,
        color: fg,
        border: `1px solid ${fg}`,
      });

      container.appendChild(tag);
    });
  } catch (error) {
    console.error('[cnki-Scholar] 获取关键词出错:', error);
  }
}

// ========== 摘要悬停 ==========

async function addHoverForAbstracts() {
  const articleLinks = getArticleLinks();

  for (const link of articleLinks) {
    if (link.dataset.abstractAdded) continue;
    link.dataset.abstractAdded = true;

    const tooltip = document.createElement('div');
    tooltip.className = 'cnki-abstract-tooltip';
    document.body.appendChild(tooltip);

    link.addEventListener('mouseenter', async () => {
      tooltip.style.display = 'block';
      tooltip.textContent = '加载摘要中...';
      positionTooltip(tooltip, link);

      try {
        const abstract = await fetchAbstract(link.href);
        tooltip.innerHTML = abstract || '<span style="color:#999">无摘要内容</span>';
        positionTooltip(tooltip, link); // 内容变化后重新定位
      } catch {
        tooltip.innerHTML = '<span style="color:red">获取摘要失败</span>';
      }
    });

    link.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

    tooltip.addEventListener('mouseenter', () => { tooltip.dataset.hovering = 'true'; });
    tooltip.addEventListener('mouseleave', () => { tooltip.dataset.hovering = 'false'; tooltip.style.display = 'none'; });
  }
}

function positionTooltip(tooltip, anchor) {
  const rect = anchor.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const tr = tooltip.getBoundingClientRect();

  let left = rect.right + 10;
  if (left + tr.width > vw - 20) {
    left = rect.left - tr.width - 10;
    if (left < 20) left = Math.max(20, (vw - tr.width) / 2);
  }

  let top = rect.top;
  if (top + tr.height > vh - 20) top = Math.max(20, vh - tr.height - 20);

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

async function fetchAbstract(articleUrl) {
  const response = await fetch(articleUrl, { credentials: 'include' });
  if (!response.ok) throw new Error('网络响应不正常');
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  const el = doc.querySelector('#ChDivSummary');
  return el ? el.textContent.trim() : null;
}

// ========== 期刊标签 ==========

async function processJournalTags() {
  try {
    // 加载/缓存期刊数据
    if (!journalCache.data || Date.now() - journalCache.lastFetch > journalCache.CACHE_DURATION) {
      journalCache.data = await fetchJournalData(
        'https://gitee.com/kailangge/cnki-journals/raw/main/cnki_journals.json'
      );
      journalCache.lastFetch = Date.now();
    }

    const journalsData = journalCache.data;
    if (!journalsData) {
      console.warn('[cnki-Scholar] 期刊数据为空，跳过标签渲染');
      return;
    }
    console.log(`[cnki-Scholar] 开始处理期刊标签，数据量: ${journalsData.length}`);

    // 搜索结果页：遍历来源单元格
    const sourceElements = document.querySelectorAll(SELECTORS.sourceCells);
    console.log(`[cnki-Scholar] 找到 ${sourceElements.length} 个期刊元素`);

    sourceElements.forEach(element => {
      if (element.querySelector('.journal-tag-container')) return;
      const nameEl = element.querySelector('a, span');
      const journalName = nameEl?.textContent.trim();
      if (!journalName) return;

      const journalInfo = findJournal(journalName, journalsData);
      if (!journalInfo) return;

      const tagContainer = document.createElement('div');
      tagContainer.className = 'journal-tag-container';
      renderJournalTags(journalInfo, tagContainer);

      if (tagContainer.hasChildNodes()) {
        nameEl.insertAdjacentElement('afterend', tagContainer);
      }

      // 清除旧的自定义元素（如有）
      const row = element.closest('tr');
      const dataEl = row?.querySelector('td.data');
      if (dataEl) dataEl.querySelectorAll('.custom-journal-info').forEach(el => el.remove());
    });

    // 详情页：期刊名在 .top-tip 下
    const detailJournalEl = document.querySelector(SELECTORS.detailJournalName);
    const hostEl = document.querySelector(SELECTORS.detailHost);
    if (detailJournalEl && hostEl && !document.querySelector('.journal-tag-container')) {
      const journalName = detailJournalEl.textContent.trim().split(' ')[0];
      const journalInfo = findJournal(journalName, journalsData);

      if (journalInfo) {
        const tagContainer = document.createElement('div');
        tagContainer.className = 'journal-tag-container';
        renderJournalTags(journalInfo, tagContainer);

        if (tagContainer.hasChildNodes()) {
          hostEl.insertAdjacentElement('afterend', tagContainer);
        }
      }
    }
  } catch (error) {
    console.error('[cnki-Scholar] 处理期刊标签时出错:', error);
  }
}

async function fetchJournalData(url) {
  try {
    const { data, error } = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ error: '请求超时(30s)' }), 30000);

      chrome.runtime.sendMessage({ url, retry: 3 }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          return resolve({ error: chrome.runtime.lastError.message });
        }
        if (!response || response.error) {
          return resolve({ error: response?.error || '无响应' });
        }
        resolve(response);
      });
    });

    if (error || !data) {
      console.error('[cnki-Scholar] 远程数据获取失败:', error);
      console.warn('[cnki-Scholar] 回退到本地默认数据');
      return DEFAULT_JOURNALS_DATA;
    }

    if (Array.isArray(data) && data.length > 0) {
      console.log(`[cnki-Scholar] 成功加载 ${data.length} 条期刊数据`);
      return data;
    }
    throw new Error('无效的数据格式');
  } catch (error) {
    console.error('[cnki-Scholar] fetchJournalData 失败:', error);
    console.warn('[cnki-Scholar] 回退到本地默认数据');
    return DEFAULT_JOURNALS_DATA;
  }
}

// ========== 批量下载 ==========

/**
 * 批量下载管理器
 * 支持: 复选框选择 / 暂停恢复 / 取消 / 逐条状态 / 验证码检测 / 可调延迟
 */
class BatchDownloadManager {
  constructor() {
    this.panel = null;
    this.itemList = null;
    this.statsEl = null;
    this.progressFill = null;
    this.startBtn = null;
    this.pauseBtn = null;
    this.cancelBtn = null;
    this.checkBtn = null;
    this.clearHistoryBtn = null;
    this.selectAllCb = null;
    this.countEl = null;
    this.delayInput = null;
    this.subdirInput = null;
    this.saveHintEl = null;

    this.tasks = [];       // { link, row, title, checkbox, statusEl, status }
    this.running = false;
    this.paused = false;
    this.cancelled = false;
    this.currentAbort = null; // 用于中断当前正在进行的 fetch

    this._initPanel();
    this._bindEvents();
  }

  /** 初始化面板 UI */
  _initPanel() {
    this.panel = document.createElement('div');
    this.panel.className = 'batch-panel hidden';
    this.panel.innerHTML = `
      <div class="batch-panel-header">
        <span>📥 批量下载</span>
        <button class="batch-panel-close" title="关闭">&times;</button>
      </div>
      <div class="batch-panel-controls">
        <label><input type="checkbox" class="cnki-row-checkbox batch-select-all" checked /> 全选</label>
        <span class="batch-count">已选 0 篇</span>
        <button class="batch-btn batch-btn-primary batch-start-btn">开始下载</button>
        <button class="batch-btn batch-btn-secondary batch-check-btn">核查</button>
        <button class="batch-btn batch-btn-warning batch-pause-btn" style="display:none">暂停</button>
        <button class="batch-btn batch-btn-danger batch-cancel-btn" style="display:none">取消</button>
        <div class="batch-delay-control">
          间隔 <input type="number" class="batch-delay-input" value="${DEFAULT_DELAY_SECONDS}" min="${MIN_DELAY_SECONDS}" max="30" /> 秒
        </div>
        <div class="batch-save-control">
          <span>保存到 下载目录/</span>
          <input class="batch-save-input" value="${DEFAULT_DOWNLOAD_SUBDIR}" title="只能填写下载目录下的子文件夹，例如 CNKI 或 CNKI/英语论文" />
          <button class="batch-btn batch-btn-secondary batch-clear-history-btn" title="清空扩展记住的已下载记录">清记录</button>
        </div>
      </div>
      <div class="batch-save-hint">当前保存目录：下载目录/${DEFAULT_DOWNLOAD_SUBDIR}</div>
      <div class="batch-progress-bar"><div class="batch-progress-fill" style="width:0%"></div></div>
      <div class="batch-panel-stats">
        <span class="batch-stats-text">等待开始</span>
        <span class="batch-stats-detail"></span>
      </div>
      <div class="batch-item-list"></div>
    `;
    document.body.appendChild(this.panel);

    // 缓存元素引用
    this.selectAllCb  = this.panel.querySelector('.batch-select-all');
    this.countEl      = this.panel.querySelector('.batch-count');
    this.startBtn     = this.panel.querySelector('.batch-start-btn');
    this.checkBtn     = this.panel.querySelector('.batch-check-btn');
    this.pauseBtn     = this.panel.querySelector('.batch-pause-btn');
    this.cancelBtn    = this.panel.querySelector('.batch-cancel-btn');
    this.clearHistoryBtn = this.panel.querySelector('.batch-clear-history-btn');
    this.delayInput   = this.panel.querySelector('.batch-delay-input');
    this.subdirInput  = this.panel.querySelector('.batch-save-input');
    this.saveHintEl   = this.panel.querySelector('.batch-save-hint');
    this.progressFill = this.panel.querySelector('.batch-progress-fill');
    this.statsEl      = this.panel.querySelector('.batch-stats-text');
    this.statsDetail  = this.panel.querySelector('.batch-stats-detail');
    this.itemList     = this.panel.querySelector('.batch-item-list');

    // 关闭按钮
    this.panel.querySelector('.batch-panel-close').addEventListener('click', () => this.hide());
  }

  /** 绑定事件 */
  _bindEvents() {
    this.selectAllCb.addEventListener('change', () => {
      const checked = this.selectAllCb.checked;
      this.tasks.forEach(t => { t.checkbox.checked = checked; });
      this._updateCount();
    });

    this.startBtn.addEventListener('click', () => this._startDownload());
    this.checkBtn.addEventListener('click', () => this._checkSelectedDownloads());
    this.pauseBtn.addEventListener('click', () => this._togglePause());
    this.cancelBtn.addEventListener('click', () => this._cancel());
    this.clearHistoryBtn.addEventListener('click', () => this._clearDownloadHistory());
    this.subdirInput.addEventListener('change', () => this._saveSubdirInput());
    this.subdirInput.addEventListener('blur', () => this._saveSubdirInput());
  }

  /** 显示面板并扫描文章列表 */
  show() {
    this._scanArticles();
    this._loadSettings();
    this.panel.classList.remove('hidden');
  }

  async _loadSettings() {
    const settings = await getStoredSettings();
    this.subdirInput.value = settings.downloadSubdir;
    this._updateSaveHint(settings.downloadSubdir);
  }

  async _saveSubdirInput() {
    const downloadSubdir = await saveDownloadSubdir(this.subdirInput.value);
    this.subdirInput.value = downloadSubdir;
    this._updateSaveHint(downloadSubdir);
    return downloadSubdir;
  }

  _updateSaveHint(downloadSubdir) {
    this.saveHintEl.textContent = `当前保存目录：下载目录/${downloadSubdir}`;
  }

  _clearDownloadHistory() {
    if (!confirm('清空已下载记录后，扩展会允许重新下载同一篇文章。确定清空？')) return;

    chrome.runtime.sendMessage({ action: 'clearDownloadHistory' }, (response) => {
      if (chrome.runtime.lastError || response?.error) {
        alert('清空失败，请重新加载扩展后再试。');
        return;
      }
      alert('已清空扩展记住的下载记录。');
    });
  }

  hide() {
    if (this.running) {
      if (!confirm('下载正在进行中，确定关闭？')) return;
      this._cancel();
    }
    this.panel.classList.add('hidden');
    this._removeCheckboxes();
  }

  /** 扫描当前页面文章，为每行添加复选框 */
  _scanArticles() {
    this.tasks = [];
    this.itemList.innerHTML = '';

    const links = getArticleLinks();
    links.forEach(link => {
      const row = link.closest('tr');
      if (!row) return;

      // 添加行首复选框（如果还没有）
      let cb = row.querySelector('.cnki-row-checkbox');
      if (!cb) {
        cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'cnki-row-checkbox';
        cb.checked = true;
        const firstTd = row.querySelector('td');
        if (firstTd) {
          firstTd.insertBefore(cb, firstTd.firstChild);
        }
      }

      const fullTitle = normalizeText(link.textContent);
      const title = fullTitle.substring(0, 50);
      const task = {
        id: `task-${this.tasks.length}`,
        link,
        row,
        title: fullTitle || title,
        displayTitle: title,
        checkbox: cb,
        status: 'pending',   // pending | downloading | success | skipped | wrongLocation | missing | failed | captcha
        statusEl: null,
      };

      cb.addEventListener('change', () => this._updateCount());

      // 面板列表项
      const itemEl = document.createElement('div');
      itemEl.className = 'batch-item';
      itemEl.innerHTML = `
        <span class="batch-item-icon">⬜</span>
        <span class="batch-item-title" title="${escapeHtml(task.title)}">${escapeHtml(task.displayTitle)}</span>
        <span class="batch-item-status pending">待下载</span>
      `;
      task.statusEl = itemEl.querySelector('.batch-item-status');
      task.itemEl = itemEl;
      task.iconEl = itemEl.querySelector('.batch-item-icon');

      this.itemList.appendChild(itemEl);
      this.tasks.push(task);
    });

    this._updateCount();
  }

  /** 移除所有复选框 */
  _removeCheckboxes() {
    document.querySelectorAll('.cnki-row-checkbox').forEach(cb => {
      if (!cb.classList.contains('batch-select-all')) cb.remove();
    });
  }

  /** 更新选中计数 */
  _updateCount() {
    const selected = this.tasks.filter(t => t.checkbox.checked).length;
    this.countEl.textContent = `已选 ${selected}/${this.tasks.length} 篇`;
    this.startBtn.disabled = selected === 0;
  }

  /** 获取选中的任务 */
  _getSelected() {
    return this.tasks.filter(t => t.checkbox.checked && ['pending', 'missing'].includes(t.status));
  }

  _buildCheckItems(tasks, downloadSubdir) {
    return tasks.flatMap((task) => {
      const articleKey = buildArticleKey(task.link.href, task.title);
      return getExpectedDownloadPaths(task.title, downloadSubdir).map(expectedPath => ({
        id: `${task.id}|${expectedPath}`,
        taskId: task.id,
        title: task.title,
        articleKey,
        filename: expectedPath,
        expectedPath,
        expectedSubdir: downloadSubdir,
      }));
    });
  }

  async _checkSelectedDownloads() {
    const selected = this.tasks.filter(t => t.checkbox.checked);
    if (selected.length === 0) return { downloaded: 0, wrongLocation: 0, missing: 0 };

    const downloadSubdir = await this._saveSubdirInput();
    const items = this._buildCheckItems(selected, downloadSubdir);
    const results = await checkDownloadedFiles(items);
    const grouped = new Map();

    results.forEach(result => {
      const taskId = result.taskId || result.id.split('|')[0];
      if (!grouped.has(taskId)) grouped.set(taskId, []);
      grouped.get(taskId).push(result);
    });

    let downloaded = 0;
    let wrongLocation = 0;
    let missing = 0;

    selected.forEach((task) => {
      const taskResults = grouped.get(task.id) || [];
      const downloadedResult = taskResults.find(r => r.status === 'downloaded');
      const wrongResult = taskResults.find(r => r.status === 'wrong-location');

      if (downloadedResult) {
        this._setTaskStatus(task, 'skipped', '已下载过');
        downloaded++;
      } else if (wrongResult) {
        this._setTaskStatus(task, 'wrongLocation', '位置不符');
        wrongLocation++;
      } else {
        this._setTaskStatus(task, 'missing', '未找到');
        missing++;
      }
    });

    this.statsEl.textContent = '核查完成';
    this.statsDetail.textContent = `已下载 ${downloaded} / 位置不符 ${wrongLocation} / 未找到 ${missing}`;
    return { downloaded, wrongLocation, missing };
  }

  /** 更新单个任务状态 */
  _setTaskStatus(task, status, detail) {
    task.status = status;
    const icons = { pending: '⬜', downloading: '⏳', success: '✅', skipped: '↩', wrongLocation: '⚠', missing: '○', failed: '❌', captcha: '🚫' };
    const labels = { pending: '待下载', downloading: '下载中', success: '成功', skipped: '已跳过', wrongLocation: '位置不符', missing: '未找到', failed: '失败', captcha: '需验证' };
    task.iconEl.textContent = icons[status] || '⬜';
    task.statusEl.textContent = detail || labels[status];
    task.statusEl.className = `batch-item-status ${status}`;
    this._updateProgress();
  }

  /** 更新进度条和统计 */
  _updateProgress() {
    const total = this.tasks.filter(t => t.checkbox.checked).length;
    if (total === 0) return;

    const done = this.tasks.filter(t => t.checkbox.checked && ['success','skipped','wrongLocation','missing','failed','captcha'].includes(t.status)).length;
    const success = this.tasks.filter(t => t.status === 'success').length;
    const skipped = this.tasks.filter(t => t.status === 'skipped').length;
    const wrongLocation = this.tasks.filter(t => t.status === 'wrongLocation').length;
    const missing = this.tasks.filter(t => t.status === 'missing').length;
    const failed = this.tasks.filter(t => t.status === 'failed').length;
    const captcha = this.tasks.filter(t => t.status === 'captcha').length;

    const pct = Math.round((done / total) * 100);
    this.progressFill.style.width = `${pct}%`;
    this.progressFill.className = 'batch-progress-fill' +
      (this.paused ? ' paused' : '') +
      (failed > success && done > 0 ? ' error' : '');

    this.statsEl.textContent = this.paused ? '⏸ 已暂停' : (this.cancelled ? '⏹ 已取消' : `${pct}% 完成`);
    let detail = `✅${success}`;
    if (skipped > 0) detail += ` ↩${skipped}`;
    if (wrongLocation > 0) detail += ` ⚠${wrongLocation}`;
    if (missing > 0) detail += ` ○${missing}`;
    if (failed > 0) detail += ` ❌${failed}`;
    if (captcha > 0) detail += ` 🚫${captcha}`;
    this.statsDetail.textContent = detail;
  }

  /** 开始下载 */
  async _startDownload() {
    const checked = this.tasks.filter(t => t.checkbox.checked);
    if (checked.length === 0) return;

    this.startBtn.disabled = true;
    this.checkBtn.disabled = true;
    this.statsEl.textContent = '正在核查已下载记录...';

    try {
      await this._checkSelectedDownloads();
    } catch (error) {
      console.error('[cnki-Scholar] 下载前核查失败:', error);
      this.statsEl.textContent = '核查失败，继续下载未完成项';
    }

    let selected = this._getSelected();
    if (selected.length === 0) {
      this.startBtn.disabled = false;
      this.checkBtn.disabled = false;
      this.statsEl.textContent = '没有需要下载的论文';
      return;
    }

    this.running = true;
    this.paused = false;
    this.cancelled = false;
    this.currentAbort = null;

    // UI 状态切换
    this.startBtn.style.display = 'none';
    this.pauseBtn.style.display = '';
    this.cancelBtn.style.display = '';
    this.selectAllCb.disabled = true;
    this.delayInput.disabled = true;
    this.subdirInput.disabled = true;
    this.checkBtn.disabled = true;
    this.clearHistoryBtn.disabled = true;
    this.tasks.forEach(t => { t.checkbox.disabled = true; });

    this.delayInput.value = normalizeDelaySeconds(this.delayInput.value);
    const downloadSubdir = await this._saveSubdirInput();
    let successCount = 0;
    let failCount = 0;

    for (let index = 0; index < selected.length; index++) {
      const task = selected[index];
      if (this.cancelled) break;

      // 等待暂停恢复
      while (this.paused && !this.cancelled) {
        await new Promise(r => setTimeout(r, 500));
      }
      if (this.cancelled) break;

      this._setTaskStatus(task, 'downloading');

      // 滚动到当前项可见
      task.itemEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      try {
        const pdfUrl = await fetchPdfUrl(task.link.href, task.row);

        if (this.cancelled) break;

        if (pdfUrl) {
          const filename = buildDownloadFilename(task.title, pdfUrl, downloadSubdir);
          const result = await downloadPdf(pdfUrl, filename, buildArticleKey(task.link.href, task.title));

          if (result?.skipped) {
            this._setTaskStatus(task, 'skipped', '已下载过');
          } else if (result?.downloadId) {
            await waitForDownload(result.downloadId);
            this._setTaskStatus(task, 'success');
          } else {
            this._setTaskStatus(task, 'failed', '未启动');
            failCount++;
            continue;
          }
          successCount++;
        } else {
          this._setTaskStatus(task, 'failed', '无下载链接');
          failCount++;
        }
      } catch (error) {
        if (this.cancelled) break;
        if (error?.message === CAPTCHA_REQUIRED) {
          this._setTaskStatus(task, 'captcha', '需人工处理');
          continue;
        } else {
          this._setTaskStatus(task, 'failed', error.message.substring(0, 20));
          failCount++;
        }
      }

      // 连续失败 3 次，自动暂停提示
      if (failCount >= 3 && successCount === 0) {
        this.paused = true;
        this.pauseBtn.textContent = '继续';
        this._updateProgress();
        alert('连续失败，可能触发了访问限制或页面结构变化。建议稍等一会儿，确认页面能正常打开后再点“继续”。');
        failCount = 0; // 重置计数
        while (this.paused && !this.cancelled) {
          await new Promise(r => setTimeout(r, 500));
        }
        if (this.cancelled) break;
      }

      // 请求间隔（随机浮动 ±30%）
      if (!this.cancelled) {
        const delaySeconds = normalizeDelaySeconds(this.delayInput.value);
        this.delayInput.value = delaySeconds;
        const delay = delaySeconds * 1000 * (0.7 + Math.random() * 0.6);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    // 下载完成
    this.running = false;
    this.startBtn.style.display = '';
    this.startBtn.disabled = false;
    this.pauseBtn.style.display = 'none';
    this.cancelBtn.style.display = 'none';
    this.selectAllCb.disabled = false;
    this.delayInput.disabled = false;
    this.subdirInput.disabled = false;
    this.checkBtn.disabled = false;
    this.clearHistoryBtn.disabled = false;
    this.tasks.forEach(t => { t.checkbox.disabled = false; });

    if (!this.cancelled) {
      this.startBtn.textContent = '继续未完成';
      this.statsEl.textContent = '✅ 已处理完成';
    }
  }

  /** 暂停/继续 */
  _togglePause() {
    this.paused = !this.paused;
    this.pauseBtn.textContent = this.paused ? '继续' : '暂停';
    this.delayInput.disabled = !this.paused;
    if (!this.paused) {
      this.delayInput.value = normalizeDelaySeconds(this.delayInput.value);
    }
    this._updateProgress();
  }

  /** 取消 */
  _cancel() {
    this.cancelled = true;
    this.paused = false;
    this.running = false;

    this.startBtn.style.display = '';
    this.pauseBtn.style.display = 'none';
    this.cancelBtn.style.display = 'none';
    this.selectAllCb.disabled = false;
    this.delayInput.disabled = false;
    this.subdirInput.disabled = false;
    this.clearHistoryBtn.disabled = false;
    pendingDownloads.forEach(waiter => waiter.reject(new Error('已取消')));
    pendingDownloads.clear();
    this.tasks.forEach(t => {
      t.checkbox.disabled = false;
      if (t.status === 'downloading') this._setTaskStatus(t, 'failed', '已取消');
    });
    this.startBtn.textContent = '继续未完成';
    this._updateProgress();
  }
}

// 批量下载管理器实例（懒初始化）
let batchManager = null;

function addDownloadAllButton() {
  if (document.querySelector('.download-all-btn')) return;

  const firstArticle = getArticleLinks()[0];
  const table = firstArticle?.closest('table');
  const fallback = document.querySelector(SELECTORS.pagesDiv);
  const target = table?.parentElement || fallback;
  if (!target) return;

  const btn = document.createElement('button');
  btn.className = 'download-all-btn';
  btn.textContent = '📥 批量下载';
  if (table?.parentElement) {
    const bar = document.createElement('div');
    bar.className = 'cnki-batch-entry-bar';
    bar.appendChild(btn);
    table.parentElement.insertBefore(bar, table);
  } else {
    fallback.appendChild(btn);
  }

  btn.addEventListener('click', () => {
    if (!batchManager) batchManager = new BatchDownloadManager();
    batchManager.show();
  });
}

// ========== 初始化 ==========

document.addEventListener('DOMContentLoaded', () => {
  if (!window.location.hostname.includes('cnki.net')) return;

  // 表格左对齐
  const style = document.createElement('style');
  style.textContent = `
    #gridTable table, #gridTable th, #gridTable td,
    .result-table-list table, .result-table-list th, .result-table-list td {
      text-align: left !important;
    }
  `;
  document.head.appendChild(style);

  addPdfDownloadButtons();
  addHoverForAbstracts();
  addDownloadAllButton();
});

// 监听动态加载（防抖）
let processing = false;
const observer = new MutationObserver(mutations => {
  if (processing) return;
  processing = true;
  setTimeout(() => {
    if (mutations.some(m => m.addedNodes.length > 0)) {
      addPdfDownloadButtons();
      addHoverForAbstracts();
      addDownloadAllButton();
      setTimeout(processJournalTags, 1000 + Math.random() * 2000);
    }
    processing = false;
  }, 500);
});

observer.observe(document.body, { childList: true, subtree: true });

// 监听来自 background.js 的下载状态通知
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'downloadStateChanged') {
    console.log(`[cnki-Scholar] 下载 ${msg.downloadId} 状态: ${msg.state}`);
    const waiter = pendingDownloads.get(msg.downloadId);
    if (waiter && msg.state === 'complete') {
      pendingDownloads.delete(msg.downloadId);
      waiter.resolve(msg);
    } else if (waiter && msg.state === 'interrupted') {
      pendingDownloads.delete(msg.downloadId);
      waiter.reject(new Error(msg.error || '下载中断'));
    }
  }
});
