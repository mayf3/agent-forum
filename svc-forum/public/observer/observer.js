/* Forum Observer — local read-only UI */
(function () {
  'use strict';

  // ── State ──
  let threads = [];
  let selectedThreadId = null;
  let messages = [];
  let knownMessageIds = new Set();
  let prevThreadsJson = '';
  let prevMessagesJson = '';
  let isAtBottom = true;
  let hasNewMessages = false;
  let searchQuery = '';
  let currentTab = 'messages';
  let transcriptData = '';
  let activeTabInitialized = { messages: false, transcript: false };

  // ── Polling ──
  const THREAD_POLL_MS = 5000;
  const MESSAGE_POLL_MS = 2500;
  let threadPollTimer = null;
  let messagePollTimer = null;
  let isPageVisible = true;

  // ── DOM refs ──
  const $ = (id) => document.getElementById(id);
  const threadListEl = $('threadList');
  const emptyState = $('emptyState');
  const threadDetail = $('threadDetail');
  const detailTitle = $('detailTitle');
  const detailStatusBadge = $('detailStatusBadge');
  const detailThreadId = $('detailThreadId');
  const detailCreated = $('detailCreated');
  const detailUpdated = $('detailUpdated');
  const detailMessageCount = $('detailMessageCount');
  const detailParticipants = $('detailParticipants');
  const messageTimeline = $('messageTimeline');
  const transcriptView = $('transcriptView');
  const searchBox = $('searchBox');
  const statusDot = $('statusDot');
  const statusText = $('statusText');
  const lastRefresh = $('lastRefresh');
  const threadCount = $('threadCount');

  // ── Utility ──
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString();
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Avatar color based on agent name (stable)
  function avatarColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [
      '#5b8def', '#f85149', '#3fb950', '#d29922', '#a371f7',
      '#58a6ff', '#79c0ff', '#56d364', '#e3b341', '#bc8cff',
      '#ff7b72', '#3fb950', '#58a6ff', '#d2a8ff', '#79c0ff',
    ];
    return colors[Math.abs(hash) % colors.length];
  }

  function avatarLetter(name) {
    return (name || '?')[0].toUpperCase();
  }

  function isScrollAtBottom(el) {
    const threshold = 40;
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }

  function scrollToBottom(el) {
    el.scrollTop = el.scrollHeight;
  }

  function shortId(uuid) {
    return uuid ? uuid.replace(/-/g, '').slice(0, 8) : '';
  }

  function abbrId(id) {
    if (!id) return '';
    // Show first 8 chars as abbreviated id
    return id.length > 8 ? id.slice(0, 8) + '\u2026' : id;
  }

  // ── API ──
  async function apiGet(path) {
    const res = await fetch(path);
    if (!res.ok) {
      const body = await res.text();
      let msg;
      try { const j = JSON.parse(body); msg = j.error || body; } catch { msg = body; }
      throw new Error(msg || 'Request failed');
    }
    return res.json();
  }

  async function apiGetText(path) {
    const res = await fetch(path);
    if (!res.ok) {
      throw new Error('Request failed');
    }
    return res.text();
  }

  // ── Status ──
  function setConnected(connected) {
    statusDot.className = 'status-dot' + (connected ? '' : ' disconnected');
    statusText.textContent = connected ? 'Connected' : 'Connection failed, retrying...';
  }

  function setLastRefresh() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    lastRefresh.textContent = 'Last refresh: ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
  }

  // ── Thread List ──
  async function fetchThreads() {
    try {
      const data = await apiGet('/observer/api/threads');
      threads = data.threads || [];
      renderThreadList();
      setConnected(true);
      threadCount.textContent = threads.length + ' threads';
    } catch (err) {
      setConnected(false);
      // Don't clear existing content on error
    }
    setLastRefresh();
  }

  function renderThreadList() {
    const query = searchQuery.toLowerCase().trim();

    let filtered = threads;
    if (query) {
      filtered = threads.filter(t => {
        const title = (t.title || '').toLowerCase();
        const sid = (t.shortId || '').toLowerCase();
        const agents = (t.participants || []).map(p => (p.agentName || '').toLowerCase()).join(' ');
        return title.includes(query) || sid.includes(query) || agents.includes(query);
      });
    }

    if (filtered.length === 0) {
      threadListEl.innerHTML = '<div class="empty-state" style="padding:20px;font-size:13px;">' +
        (query ? 'No threads match your search' : 'No threads yet') +
        '</div>';
      return;
    }

    // Sort by lastMessageAt desc, then updatedAt desc
    filtered.sort((a, b) => {
      const aTime = a.lastMessageAt || a.updatedAt || a.createdAt;
      const bTime = b.lastMessageAt || b.updatedAt || b.createdAt;
      return bTime.localeCompare(aTime);
    });

    let html = '';
    for (const t of filtered) {
      const isActive = t.id === selectedThreadId;
      const agentNames = (t.participants || []).map(p => p.agentName).filter(Boolean).join(', ');
      const statusClass = 'badge-' + (t.status === 'open' ? 'open' : t.status === 'resolved' ? 'resolved' : 'archived');
      const lastActive = t.lastMessageAt || t.updatedAt || t.createdAt;

      html += '<div class="thread-item' + (isActive ? ' active' : '') + '" data-id="' + t.id + '">' +
        '<div class="thread-item-title">' + escapeHtml(t.title || 'Untitled') + '</div>' +
        '<div class="thread-item-meta">' +
          '<span class="badge ' + statusClass + '">' + escapeHtml(t.status) + '</span>' +
          '<span>' + (t.messageCount || 0) + ' msgs</span>' +
          '<span>' + fmtTime(lastActive) + '</span>' +
        '</div>' +
        (agentNames ? '<div class="agent-names">' + escapeHtml(agentNames) + '</div>' : '') +
      '</div>';
    }

    threadListEl.innerHTML = html;

    // Click handler
    threadListEl.querySelectorAll('.thread-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        if (id && id !== selectedThreadId) {
          selectThread(id);
        }
      });
    });
  }

  // ── Thread Detail ──
  async function selectThread(threadId) {
    selectedThreadId = threadId;
    hasNewMessages = false;
    activeTabInitialized = { messages: false, transcript: false };

    emptyState.style.display = 'none';
    threadDetail.style.display = 'flex';

    // Highlight in list
    threadListEl.querySelectorAll('.thread-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === threadId);
    });

    // Fetch thread detail
    try {
      const data = await apiGet('/observer/api/threads/' + threadId);
      const t = data.thread;
      renderDetail(t);
      // Start message polling
      startMessagePolling(threadId);
    } catch (err) {
      detailTitle.textContent = 'Error loading thread';
      messageTimeline.innerHTML = '<div class="empty-state">Failed to load thread: ' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderDetail(t) {
    detailTitle.textContent = t.title || 'Untitled';

    const statusClass = 'badge-' + (t.status === 'open' ? 'open' : t.status === 'resolved' ? 'resolved' : 'archived');
    detailStatusBadge.className = 'badge ' + statusClass;
    detailStatusBadge.textContent = t.status || '—';

    detailThreadId.textContent = t.id;
    detailThreadId.title = 'Click to copy: ' + t.id;
    detailThreadId.onclick = function () {
      navigator.clipboard.writeText(t.id).catch(function () {});
    };

    detailCreated.textContent = 'Created: ' + fmtDate(t.createdAt);
    detailUpdated.textContent = 'Updated: ' + fmtDate(t.updatedAt);
    detailMessageCount.textContent = (t.messageCount || 0) + ' messages';

    // Participants
    const parts = (t.participants || []).map(function (p) {
      return escapeHtml(p.agentName || p.agentId || 'Unknown') + ' (' + escapeHtml(p.role) + ')';
    });
    detailParticipants.textContent = 'Participants: ' + (parts.length ? parts.join(', ') : 'None');
  }

  // ── Messages ──
  async function fetchMessages(threadId) {
    try {
      const data = await apiGet('/observer/api/threads/' + threadId + '/messages');
      return data;
    } catch (err) {
      throw err;
    }
  }

  function startMessagePolling(threadId) {
    stopMessagePolling();
    prevMessagesJson = '';
    knownMessageIds = new Set();
    loadMessagesForTab(threadId, 'messages');
    messagePollTimer = setInterval(function () {
      if (!isPageVisible) return;
      loadMessagesForTab(threadId, 'messages');
    }, MESSAGE_POLL_MS);
  }

  function stopMessagePolling() {
    if (messagePollTimer) {
      clearInterval(messagePollTimer);
      messagePollTimer = null;
    }
  }

  async function loadMessagesForTab(threadId, tab) {
    if (currentTab !== tab && tab === 'messages') return;
    if (currentTab !== tab && tab === 'transcript') return;

    try {
      const data = await fetchMessages(threadId);
      messages = data.messages || [];
      renderMessages(messages);
      setConnected(true);
      activeTabInitialized[tab] = true;
    } catch (err) {
      setConnected(false);
    }
  }

  function renderMessages(msgs) {
    if (msgs.length === 0) {
      if (!prevMessagesJson) {
        messageTimeline.innerHTML = '<div class="empty-state">No messages yet</div>';
      }
      return;
    }

    const json = JSON.stringify(msgs.map(m => m.id + m.seq + (m.content || '').slice(0, 50)));
    if (json === prevMessagesJson) {
      // No change — update scroll check
      isAtBottom = isScrollAtBottom(messageTimeline);
      return;
    }

    // Track new messages
    const prevCount = knownMessageIds.size;
    for (const m of msgs) {
      knownMessageIds.add(m.id);
    }
    const hasNew = knownMessageIds.size > prevCount;
    if (hasNew && prevCount > 0 && !isAtBottom) {
      hasNewMessages = true;
    }

    const wasEmpty = prevMessagesJson === '';
    prevMessagesJson = json;

    let html = '';
    for (const m of msgs) {
      const kind = m.kind || 'message';
      const kindClass = 'message-kind-' + kind;
      const time = fmtTime(m.createdAt);
      const color = avatarColor(m.authorName || '');
      const letter = avatarLetter(m.authorName || '');

      html += '<div class="message">' +
        '<div class="message-header">' +
          '<div class="message-avatar" style="background:' + color + '">' + letter + '</div>' +
          '<span class="message-author">' + escapeHtml(m.authorName || 'Unknown') + '</span>' +
          '<span class="message-authorid" title="' + escapeHtml(m.authorId || '') + '">' + escapeHtml(abbrId(m.authorId)) + '</span>' +
          '<span class="message-kind ' + kindClass + '">' + escapeHtml(kind) + '</span>' +
          '<span class="message-seq">#' + m.seq + '</span>' +
          '<span class="message-time">' + time + '</span>' +
        '</div>' +
        '<div class="message-body"></div>' +
        (m.mentions && m.mentions.length > 0
          ? '<div class="message-mentions">Mentions: ' + escapeHtml(m.mentions.join(', ')) + '</div>'
          : '') +
      '</div>';
    }

    messageTimeline.innerHTML = html;

    // Set body content with textContent for safety
    messageTimeline.querySelectorAll('.message').forEach((el, i) => {
      if (i < msgs.length) {
        const body = el.querySelector('.message-body');
        if (body) {
          body.textContent = msgs[i].content || '';
        }
      }
    });

    // Scroll behavior
    isAtBottom = isScrollAtBottom(messageTimeline);
    if (wasEmpty || isAtBottom) {
      scrollToBottom(messageTimeline);
      isAtBottom = true;
    }

    // Show new messages banner
    if (hasNewMessages) {
      const banner = document.createElement('div');
      banner.className = 'new-messages-banner';
      banner.textContent = 'New messages — click to scroll down';
      banner.addEventListener('click', function () {
        scrollToBottom(messageTimeline);
        isAtBottom = true;
        hasNewMessages = false;
        banner.remove();
      });
      // Append banner, remove existing ones
      const existing = messageTimeline.querySelector('.new-messages-banner');
      if (existing) existing.remove();
      messageTimeline.appendChild(banner);
    }
  }

  // ── Transcript ──
  async function loadTranscript(threadId) {
    if (activeTabInitialized.transcript) return;
    try {
      const text = await apiGetText('/observer/api/threads/' + threadId + '/transcript?format=md');
      transcriptData = text;
      const pre = transcriptView.querySelector('pre') || document.createElement('pre');
      pre.textContent = text;
      if (!transcriptView.querySelector('pre')) {
        transcriptView.innerHTML = '';
        transcriptView.appendChild(pre);
      }
      setConnected(true);
      activeTabInitialized.transcript = true;
    } catch (err) {
      transcriptView.innerHTML = '<div class="empty-state">Failed to load transcript: ' + escapeHtml(err.message) + '</div>';
      setConnected(false);
    }
  }

  // ── Tab switching ──
  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(function (el) {
      el.classList.toggle('active', el.dataset.tab === tab);
    });

    if (tab === 'messages') {
      messageTimeline.style.display = '';
      transcriptView.style.display = 'none';
      if (selectedThreadId && !activeTabInitialized.messages) {
        loadMessagesForTab(selectedThreadId, 'messages');
      }
    } else {
      messageTimeline.style.display = 'none';
      transcriptView.style.display = '';
      if (selectedThreadId && !activeTabInitialized.transcript) {
        loadTranscript(selectedThreadId);
      }
    }
  }

  // ── Visibility handling ──
  function handleVisibilityChange() {
    isPageVisible = !document.hidden;
    if (isPageVisible) {
      // Immediate refresh
      fetchThreads();
      if (selectedThreadId) {
        loadMessagesForTab(selectedThreadId, 'messages');
      }
    }
  }

  // ── Init ──
  function init() {
    // Tab switching
    document.querySelectorAll('.tab').forEach(function (el) {
      el.addEventListener('click', function () {
        switchTab(el.dataset.tab);
      });
    });

    // Search
    searchBox.addEventListener('input', function () {
      searchQuery = searchBox.value;
      renderThreadList();
    });

    // Visibility
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Thread polling
    fetchThreads();
    threadPollTimer = setInterval(function () {
      if (!isPageVisible) return;
      fetchThreads();
    }, THREAD_POLL_MS);

    // Periodic visibility check (reduced polling when hidden)
    setInterval(function () {
      if (!isPageVisible) {
        // Still poll threads but less frequently (every 15s)
        fetchThreads();
      }
    }, 15000);
  }

  // Start
  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();
})();
