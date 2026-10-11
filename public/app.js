// RollScout front end. Plain JavaScript, no build step.

const $ = (sel) => document.querySelector(sel);
const STORAGE_KEY = 'rollscout:v1';

const state = {
  config: null,
  platforms: {}, // id -> { enabled, key }
  anthropicKey: '',
  topics: [],
  results: [], // index-aligned with topics searched
  searchedTopics: [],
  selected: new Set(),
  itemsById: new Map(),
};

// ---------- helpers ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function slug(s, max = 40) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '') || 'topic';
}

function formatDuration(sec) {
  if (!sec && sec !== 0) return '';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function countWords(text) {
  return (text.match(/\S+/g) || []).length;
}

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function setStep(n) {
  document.querySelectorAll('.stepper li').forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle('active', s === n);
    li.classList.toggle('done', s < n);
  });
}

function setBusy(btn, busy) {
  btn.disabled = busy;
  btn.classList.toggle('busy', busy);
}

// ---------- persistence ----------

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function save() {
  const remember = $('#remember-keys').checked;
  const data = {
    remember,
    settings: {
      perTopic: $('#per-topic').value,
      maxTopics: $('#max-topics').value,
      imageQuality: $('#image-quality').value,
      videoQuality: $('#video-quality').value,
      method: document.querySelector('input[name=method]:checked').value,
    },
    enabled: Object.fromEntries(Object.entries(state.platforms).map(([id, p]) => [id, p.enabled])),
  };
  if (remember) {
    data.keys = Object.fromEntries(Object.entries(state.platforms).map(([id, p]) => [id, p.key || '']));
    data.anthropicKey = state.anthropicKey;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* storage unavailable */ }
}

// ---------- step 1: script ----------

function updateWordCount() {
  const n = countWords($('#script-text').value);
  $('#word-count').textContent = `${n.toLocaleString()} word${n === 1 ? '' : 's'}`;
}

async function uploadFile(file) {
  const dz = $('#dropzone');
  dz.querySelector('strong').textContent = `Reading ${file.name}...`;
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch('/api/script', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    $('#script-text').value = data.text;
    updateWordCount();
    dz.querySelector('strong').textContent = `Loaded ${data.filename} (${data.words.toLocaleString()} words)`;
    setStep(2);
  } catch (err) {
    dz.querySelector('strong').textContent = err.message;
  }
}

function initScript() {
  const dz = $('#dropzone');
  const input = $('#file-input');
  input.addEventListener('change', () => input.files[0] && uploadFile(input.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault();
    dz.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('over')));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  });
  $('#script-text').addEventListener('input', updateWordCount);
}

// ---------- step 2: platforms ----------

function renderProviders(saved) {
  const wrap = $('#providers');
  wrap.textContent = '';
  for (const p of state.config.providers) {
    const savedEnabled = saved.enabled?.[p.id];
    state.platforms[p.id] = {
      enabled: savedEnabled ?? (p.requiresKey ? true : false),
      key: saved.keys?.[p.id] || '',
    };
    const node = $('#tpl-provider').content.firstElementChild.cloneNode(true);
    node.querySelector('.provider-name').textContent = p.name;
    const badges = node.querySelector('.badges');
    if (p.supports.includes('image')) badges.append(el('span', { class: 'badge', text: 'Images' }));
    if (p.supports.includes('video')) badges.append(el('span', { class: 'badge', text: 'Videos' }));
    const link = node.querySelector('.provider-link');
    link.href = p.signupUrl;
    const status = node.querySelector('.provider-status');
    const body = node.querySelector('.provider-body');

    const markConnected = (ok, msg) => {
      node.classList.toggle('connected', ok === true);
      status.className = `small provider-status ${ok === true ? 'ok' : ok === false ? 'err' : ''}`;
      status.textContent = msg || '';
    };

    if (p.requiresKey) {
      const input = el('input', {
        type: 'password',
        placeholder: p.serverKey ? 'Using the server key' : (p.keyHint || 'Paste API key'),
        autocomplete: 'off',
        spellcheck: 'false',
        'aria-label': `${p.name} API key`,
      });
      input.value = state.platforms[p.id].key;
      input.addEventListener('input', () => {
        state.platforms[p.id].key = input.value.trim();
        markConnected(null, '');
        save();
      });
      const verify = el('button', { class: 'btn small', type: 'button', text: 'Test' });
      verify.addEventListener('click', async () => {
        setBusy(verify, true);
        markConnected(null, 'Checking...');
        try {
          const r = await api('/api/verify', { provider: p.id, key: state.platforms[p.id].key });
          markConnected(r.ok, r.ok ? 'Connected' : r.message);
        } catch (err) {
          markConnected(false, err.message);
        }
        setBusy(verify, false);
      });
      body.append(input, verify);
      if (p.serverKey) markConnected(true, 'Server key available');
      else if (state.platforms[p.id].key) markConnected(null, 'Key saved');
      link.textContent = p.serverKey ? 'Get your own key' : 'Get a free key';
    } else {
      const toggle = el('input', { type: 'checkbox' });
      toggle.checked = state.platforms[p.id].enabled;
      toggle.addEventListener('change', () => {
        state.platforms[p.id].enabled = toggle.checked;
        markConnected(toggle.checked ? true : null, toggle.checked ? 'Enabled' : '');
        save();
      });
      body.append(el('label', { class: 'check', style: 'margin:0' }, toggle, el('span', { text: 'Search this platform (no key needed)' })));
      link.textContent = 'About';
      if (toggle.checked) markConnected(true, 'Enabled');
    }
    wrap.append(node);
  }
}

function connectedPlatforms() {
  const out = {};
  for (const p of state.config.providers) {
    const s = state.platforms[p.id];
    if (!s?.enabled) continue;
    if (p.requiresKey && !s.key && !p.serverKey) continue;
    out[p.id] = { enabled: true, key: s.key || '' };
  }
  return out;
}

function initSettings(saved) {
  const s = saved.settings || {};
  if (s.perTopic) $('#per-topic').value = s.perTopic;
  if (s.maxTopics) $('#max-topics').value = s.maxTopics;
  if (s.imageQuality) $('#image-quality').value = s.imageQuality;
  if (s.videoQuality) $('#video-quality').value = s.videoQuality;
  if (s.method) {
    const radio = document.querySelector(`input[name=method][value="${s.method}"]`);
    if (radio) radio.checked = true;
  }
  $('#remember-keys').checked = Boolean(saved.remember);
  state.anthropicKey = saved.anthropicKey || '';
  $('#anthropic-key').value = state.anthropicKey;
  if (state.config.ai.serverKey) {
    $('#ai-server-note').textContent = 'A key is configured on the server. Leave this empty to use it.';
  }

  const syncMethod = () => {
    $('#ai-key-field').hidden = document.querySelector('input[name=method]:checked').value !== 'ai';
  };
  document.querySelectorAll('input[name=method]').forEach((r) => r.addEventListener('change', () => {
    syncMethod();
    save();
  }));
  syncMethod();
  $('#anthropic-key').addEventListener('input', (e) => {
    state.anthropicKey = e.target.value.trim();
    save();
  });
  ['#per-topic', '#max-topics', '#image-quality', '#video-quality'].forEach((id) => $(id).addEventListener('change', save));
  $('#remember-keys').addEventListener('change', save);
}

// ---------- step 3: topics ----------

async function findTopics() {
  const text = $('#script-text').value.trim();
  const status = $('#topics-status');
  if (!text) {
    status.textContent = 'Add a script first.';
    $('#script-text').focus();
    return;
  }
  const btn = $('#find-topics');
  setBusy(btn, true);
  const method = document.querySelector('input[name=method]:checked').value;
  status.textContent = method === 'ai' ? 'Asking Claude to map out the script...' : 'Reading the script...';
  try {
    const data = await api('/api/topics', {
      text,
      method,
      anthropicKey: state.anthropicKey,
      maxTopics: Number($('#max-topics').value) || 8,
    });
    state.topics = data.topics.map((t) => ({ ...t, queries: [...t.queries] }));
    const warn = $('#topics-warning');
    warn.hidden = !data.warning;
    warn.textContent = data.warning || '';
    status.textContent = `${state.topics.length} topic${state.topics.length === 1 ? '' : 's'} found.`;
    renderTopics();
    $('#step-topics').hidden = false;
    setStep(3);
    $('#step-topics').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    status.textContent = err.message;
  }
  setBusy(btn, false);
}

function renderTopics() {
  const list = $('#topic-list');
  list.textContent = '';
  if (!state.topics.length) {
    list.append(el('p', { class: 'empty', text: 'No topics yet. Add one below.' }));
  }
  state.topics.forEach((topic, i) => {
    const title = el('input', { type: 'text', class: 'topic-title', 'aria-label': 'Topic title' });
    title.value = topic.title;
    title.addEventListener('input', () => { topic.title = title.value; });

    const chips = el('div', { class: 'chips' });
    const drawChips = () => {
      chips.textContent = '';
      topic.queries.forEach((q, qi) => {
        chips.append(el('span', { class: 'chip' }, q, el('button', {
          type: 'button',
          title: 'Remove search phrase',
          'aria-label': `Remove ${q}`,
          onclick: () => {
            topic.queries.splice(qi, 1);
            drawChips();
          },
        }, '×')));
      });
      const add = el('input', { type: 'text', placeholder: '+ add search phrase', 'aria-label': 'Add search phrase' });
      add.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && add.value.trim()) {
          e.preventDefault();
          topic.queries.push(add.value.trim());
          drawChips();
          chips.querySelector('input').focus();
        }
      });
      chips.append(add);
    };
    drawChips();

    list.append(el('div', { class: 'topic-edit' },
      el('span', { class: 'idx', text: String(i + 1).padStart(2, '0') }),
      title,
      el('button', {
        class: 'icon-btn',
        type: 'button',
        title: 'Remove topic',
        'aria-label': 'Remove topic',
        onclick: () => {
          state.topics.splice(i, 1);
          renderTopics();
        },
      }, '×'),
      topic.summary ? el('p', { class: 'summary muted', text: topic.summary }) : null,
      chips));
  });
}

// ---------- step 4: search & results ----------

function itemFileName(item) {
  const base = slug(item.title || item.provider, 36);
  return `${item.provider}-${base}-${item.id.split('-').pop()}.${item.ext || (item.type === 'video' ? 'mp4' : 'jpg')}`;
}

function topicFolder(i) {
  return `${String(i + 1).padStart(2, '0')}-${slug(state.searchedTopics[i]?.title || `topic-${i + 1}`)}`;
}

function downloadHref(item) {
  return `/api/download?url=${encodeURIComponent(item.downloadUrl)}&name=${encodeURIComponent(itemFileName(item))}`;
}

function trackDownload(item) {
  if (item.trackUrl) {
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: item.trackUrl, key: state.platforms.unsplash?.key || '' }),
    }).catch(() => {});
  }
}

function updateSelectionUi() {
  const n = state.selected.size;
  $('#selection-count').textContent = `${n} selected`;
  $('#zip-selected').disabled = n === 0;
  $('#zip-selected').textContent = n ? `Download selected (${n}) ZIP` : 'Download selected (ZIP)';
}

function toggleSelect(id, on) {
  if (on) state.selected.add(id);
  else state.selected.delete(id);
  document.querySelectorAll(`.media[data-key="${CSS.escape(id)}"]`).forEach((card) => {
    card.classList.toggle('selected', on);
    card.querySelector('.select-box').checked = on;
  });
  updateSelectionUi();
}

function openViewer(item) {
  const dlg = $('#viewer');
  const media = $('#viewer-media');
  media.textContent = '';
  if (item.type === 'video') {
    media.append(el('video', { src: item.displayUrl, poster: item.previewUrl, controls: true, autoplay: true, playsinline: true }));
  } else {
    media.append(el('img', { src: item.displayUrl || item.previewUrl, alt: item.title }));
  }
  $('#viewer-title').textContent = item.title;
  const meta = [
    item.providerName,
    item.author ? `by ${item.author}` : null,
    item.width && item.height ? `${item.width}×${item.height}` : null,
    item.duration ? formatDuration(item.duration) : null,
    item.license,
  ].filter(Boolean).join(' · ');
  $('#viewer-meta').textContent = meta;
  const dl = $('#viewer-download');
  dl.href = downloadHref(item);
  dl.onclick = () => trackDownload(item);
  $('#viewer-source').href = item.pageUrl || '#';
  dlg.showModal();
}

function closeViewer() {
  const dlg = $('#viewer');
  dlg.querySelector('video')?.pause();
  dlg.close();
}

function mediaCard(item, key) {
  const isVideo = item.type === 'video';
  const thumb = el('button', { class: 'thumb', type: 'button', title: 'Preview', onclick: () => openViewer(item) },
    el('img', { src: item.previewUrl || item.displayUrl, alt: item.title, loading: 'lazy' }),
    isVideo ? el('span', { class: 'play' }, el('span')) : null,
    isVideo && item.duration ? el('span', { class: 'pill dur', text: formatDuration(item.duration) }) : null,
    el('span', { class: 'pill src', text: item.providerName }),
    item.sharedWithOtherTopic ? el('span', { class: 'pill shared', text: 'Also in another topic' }) : null);

  if (isVideo && item.displayUrl) {
    // Hover to preview the clip without opening it.
    let video = null;
    thumb.addEventListener('mouseenter', () => {
      if (video) return;
      video = el('video', { src: item.displayUrl, muted: true, autoplay: true, loop: true, playsinline: true, preload: 'none' });
      video.muted = true;
      thumb.prepend(video);
      thumb.querySelector('img').hidden = true;
      thumb.querySelector('.play')?.classList.add('hide');
    });
    thumb.addEventListener('mouseleave', () => {
      if (!video) return;
      video.remove();
      video = null;
      thumb.querySelector('img').hidden = false;
      thumb.querySelector('.play')?.classList.remove('hide');
    });
  }

  const box = el('input', { type: 'checkbox', class: 'select-box', 'aria-label': `Select ${item.title}` });
  box.checked = state.selected.has(key);
  box.addEventListener('change', () => toggleSelect(key, box.checked));

  const dl = el('a', { class: 'btn small', href: downloadHref(item), text: 'Download', onclick: () => trackDownload(item) });
  return el('div', { class: `media${state.selected.has(key) ? ' selected' : ''}`, 'data-key': key },
    thumb,
    box,
    el('div', { class: 'media-foot' },
      el('span', { class: 'credit', title: item.author || '', text: item.author ? `by ${item.author}` : item.providerName }),
      dl));
}

function topicItems(i, type) {
  const r = state.results[i];
  if (!r) return [];
  if (type === 'image') return r.images;
  if (type === 'video') return r.videos;
  return [...r.images, ...r.videos];
}

function itemKey(i, item) {
  return `${i}:${item.id}`;
}

function renderTopicResult(i) {
  const topic = state.searchedTopics[i];
  const r = state.results[i];
  const host = $(`#result-${i}`);
  host.textContent = '';
  const zipTopic = el('button', {
    class: 'btn small primary',
    type: 'button',
    text: 'Download topic (ZIP)',
    onclick: () => downloadZip(topicItems(i).map((it) => [i, it]), `rollscout-${topicFolder(i)}`),
  });
  const selectTopic = el('button', {
    class: 'btn small ghost',
    type: 'button',
    text: 'Select topic',
    onclick: () => topicItems(i).forEach((it) => toggleSelect(itemKey(i, it), true)),
  });

  const notes = el('ul', { class: 'topic-notes' });
  for (const n of r.notes || []) notes.append(el('li', { text: n }));
  if (r.queriesTried?.length) {
    notes.append(el('li', { class: 'info', text: `Searched for: ${r.queriesTried.join(', ')}` }));
  }

  host.append(el('div', { class: 'topic-result-head' },
    el('div', {},
      el('h3', { text: `${String(i + 1).padStart(2, '0')}  ${topic.title}` }),
      el('p', { class: 'meta muted small', text: `${r.images.length} images · ${r.videos.length} videos` })),
    el('div', { class: 'topic-buttons' }, selectTopic, zipTopic)));
  host.append(notes);

  for (const type of ['image', 'video']) {
    const list = type === 'image' ? r.images : r.videos;
    const label = type === 'image' ? 'Images' : 'Videos';
    const head = el('div', { class: 'type-head' },
      el('h4', { text: label }),
      el('span', { class: 'count', text: String(list.length) }),
      el('span', { class: 'spacer' }),
      list.length ? el('button', {
        class: 'btn small ghost',
        type: 'button',
        text: `${label} only (ZIP)`,
        onclick: () => downloadZip(list.map((it) => [i, it]), `rollscout-${topicFolder(i)}-${label.toLowerCase()}`),
      }) : null);
    const grid = el('div', { class: 'grid' });
    if (!list.length) grid.append(el('p', { class: 'empty', text: `No ${label.toLowerCase()} found for this topic.` }));
    for (const item of list) {
      const key = itemKey(i, item);
      state.itemsById.set(key, [i, item]);
      grid.append(mediaCard(item, key));
    }
    host.append(head, grid);
  }
}

function downloadZip(pairs, name) {
  if (!pairs.length) return;
  const items = pairs.map(([i, item]) => ({
    url: item.downloadUrl,
    path: `${topicFolder(i)}/${item.type === 'video' ? 'videos' : 'images'}/${itemFileName(item)}`,
    title: item.title,
    author: item.author,
    authorUrl: item.authorUrl,
    pageUrl: item.pageUrl,
    license: item.license,
    providerName: item.providerName,
    trackUrl: item.trackUrl,
  }));
  $('#zip-payload').value = JSON.stringify({ name, items, unsplashKey: state.platforms.unsplash?.key || '' });
  $('#zip-form').submit();
}

async function searchMedia() {
  const topics = state.topics
    .map((t) => ({ ...t, title: t.title.trim() || 'Untitled topic', queries: t.queries.filter((q) => q.trim()) }))
    .filter((t) => t.queries.length);
  if (!topics.length) {
    alert('Add at least one topic with a search phrase.');
    return;
  }
  const platforms = connectedPlatforms();
  if (!Object.keys(platforms).length) {
    alert('Connect at least one platform in step 2 (add an API key or enable Wikimedia Commons).');
    $('#step-platforms').scrollIntoView({ behavior: 'smooth' });
    return;
  }

  const btn = $('#search-media');
  setBusy(btn, true);
  state.searchedTopics = topics;
  state.results = new Array(topics.length);
  state.selected.clear();
  state.itemsById.clear();
  updateSelectionUi();

  $('#step-results').hidden = false;
  setStep(4);
  $('#warnings').textContent = '';
  $('#progress').classList.remove('done');
  $('#progress-bar').style.width = '3%';
  $('#toolbar').hidden = true;
  const results = $('#results');
  results.textContent = '';
  topics.forEach((t, i) => results.append(el('div', { class: 'topic-result', id: `result-${i}` },
    el('div', { class: 'topic-result-head' }, el('div', {},
      el('h3', { text: `${String(i + 1).padStart(2, '0')}  ${t.title}` }),
      el('p', { class: 'meta muted small', text: 'Waiting...' }))))));
  $('#results-summary').textContent = `Searching ${topics.length} topic${topics.length === 1 ? '' : 's'}...`;
  $('#step-results').scrollIntoView({ behavior: 'smooth', block: 'start' });

  let done = 0;
  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topics,
        platforms,
        options: {
          perTopic: Number($('#per-topic').value) || 10,
          imageQuality: $('#image-quality').value,
          videoQuality: $('#video-quality').value,
        },
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Search failed (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.type === 'start') {
          $('#results-summary').textContent = `Searching ${msg.topics} topics on ${msg.platforms.join(', ')}...`;
        } else if (msg.type === 'topic') {
          state.results[msg.index] = msg.result;
          renderTopicResult(msg.index);
          done += 1;
          $('#progress-bar').style.width = `${Math.round((done / topics.length) * 100)}%`;
          $('#toolbar').hidden = false;
        } else if (msg.type === 'warning') {
          $('#warnings').append(el('div', { class: 'banner warn', text: msg.message }));
        } else if (msg.type === 'error') {
          $('#warnings').append(el('div', { class: 'banner err', text: msg.message }));
        }
      }
      if (finished) break;
    }
  } catch (err) {
    $('#warnings').append(el('div', { class: 'banner err', text: err.message }));
  }

  $('#progress').classList.add('done');
  const imgs = state.results.reduce((s, r) => s + (r?.images.length || 0), 0);
  const vids = state.results.reduce((s, r) => s + (r?.videos.length || 0), 0);
  $('#results-summary').textContent = `${imgs} images and ${vids} videos across ${topics.length} topic${topics.length === 1 ? '' : 's'}. Click any item to preview it.`;
  setBusy(btn, false);
}

function allPairs() {
  return state.results.flatMap((r, i) => (r ? [...r.images, ...r.videos].map((it) => [i, it]) : []));
}

// ---------- install as an app (Chrome, Edge) ----------

function initInstall() {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  let deferred = null;
  const btn = $('#install-app');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });
  btn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    btn.hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    btn.hidden = true;
  });
}

// ---------- boot ----------

async function boot() {
  initInstall();
  initScript();
  try {
    const res = await fetch('/api/config');
    state.config = await res.json();
  } catch {
    $('#providers').append(el('div', { class: 'banner err', text: 'Could not reach the RollScout server.' }));
    return;
  }
  const saved = loadSaved();
  renderProviders(saved);
  initSettings(saved);

  $('#find-topics').addEventListener('click', findTopics);
  $('#add-topic').addEventListener('click', () => {
    state.topics.push({ id: `custom-${Date.now()}`, title: 'New topic', queries: [], keywords: [] });
    renderTopics();
    const inputs = document.querySelectorAll('.topic-edit .topic-title');
    inputs[inputs.length - 1]?.select();
  });
  $('#search-media').addEventListener('click', searchMedia);
  $('#select-all').addEventListener('click', () => {
    allPairs().forEach(([i, it]) => toggleSelect(itemKey(i, it), true));
  });
  $('#select-none').addEventListener('click', () => {
    [...state.selected].forEach((k) => toggleSelect(k, false));
  });
  $('#zip-selected').addEventListener('click', () => {
    const pairs = [...state.selected].map((k) => state.itemsById.get(k)).filter(Boolean);
    downloadZip(pairs, 'rollscout-selected');
  });
  $('#zip-all').addEventListener('click', () => downloadZip(allPairs(), 'rollscout-all-topics'));
  $('#viewer-close').addEventListener('click', closeViewer);
  $('#viewer').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeViewer();
  });
  $('#viewer').addEventListener('close', () => $('#viewer').querySelector('video')?.pause());
}

boot();
