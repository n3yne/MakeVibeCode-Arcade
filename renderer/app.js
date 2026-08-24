// MakeVibeCode Arcade - AI Chat Panel Logic

const DEFAULT_SYSTEM_PROMPT = `You are a friendly coding helper for kids making MakeCode Arcade games! Keep all ideas fun, positive, and appropriate for children aged 6-12.

Your responses are shown in a collapsed view, so ALWAYS use this exact format:

📋 [One sentence: what you did or what the code does — use simple, encouraging language]
▶ [One sentence: what the kid should do or try next — or "Your game is ready to play! 🎉" if done]

---

[Full technical details, explanation, and code blocks go here — this section is hidden by default]

Rules:
- The summary lines (📋 and ▶) must be the very first two lines, each on its own line
- Put ALL code blocks after the --- separator, never before it
- Always output the COMPLETE TypeScript file in a single \`\`\`typescript block after ---
- Never output partial snippets — full file only
- MakeCode Arcade uses a subset of TypeScript; avoid advanced TS features
- Keep explanations simple — imagine explaining to a curious 8-year-old
- Game ideas should be fun, friendly, and age-appropriate (think: adventure, animals, puzzles, sports, space)

Key MakeCode Arcade APIs:
- sprites.create(img\`...\`, SpriteKind.Player)
- controller.moveSprite(mySprite, 100, 100)
- scene.setBackgroundColor(color)
- info.setScore(0), info.setLife(3)
- game.onUpdate(() => { })
- sprites.onOverlap(SpriteKind.A, SpriteKind.B, (a, b) => { })`;

const MAX_ERROR_ITERATIONS = 3;
const ERROR_SETTLE_MS = 2500;

// ── State ──────────────────────────────────────────────────────────────────
let settings = {
  provider: 'google',
  apiKey: '',
  model: 'gemini-3.1-flash-lite',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};
let conversationHistory = [];
let attachedCode = null;
let isRequesting = false;
let panelVisible = true;

// Current conversation
let currentConv = null; // { id, name, messages, createdAt, updatedAt }

// ── DOM refs ───────────────────────────────────────────────────────────────
// arcade-webview is created dynamically by window.platform.initArcadeView()
const messagesEl = document.getElementById('messages');
const userInput = document.getElementById('user-input');
const btnSend = document.getElementById('btn-send');
const btnGetCode = document.getElementById('btn-get-code');
const btnClearChat = document.getElementById('btn-clear-chat');
const btnTogglePanel = document.getElementById('btn-toggle-panel');
const btnSettings = document.getElementById('btn-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const settingsModal = document.getElementById('settings-modal');
const btnHelp = document.getElementById('btn-help');
const btnCloseHelp = document.getElementById('btn-close-help');
const btnCloseHelpFooter = document.getElementById('btn-close-help-footer');
const helpModal = document.getElementById('help-modal');
const btnCopyGeminiUrl = document.getElementById('btn-copy-gemini-url');
const btnOpenGeminiUrl = document.getElementById('btn-open-gemini-url');
const helpGeminiUrl = document.getElementById('help-gemini-url');
const helpCopyFeedback = document.getElementById('help-copy-feedback');
const btnLoadModels = document.getElementById('btn-load-models');
const apikeyTestStatus = document.getElementById('apikey-test-status');
const settingModelSelect = document.getElementById('setting-model-select');
const aiPanel = document.getElementById('ai-panel');
const codeContextBar = document.getElementById('code-context-bar');
const contextLabel = document.getElementById('context-label');
const btnRemoveContext = document.getElementById('btn-remove-context');
const resizer = document.getElementById('resizer');
const convSelect = document.getElementById('conv-select');
const convRenameInput = document.getElementById('conv-rename-input');
const btnNewConv = document.getElementById('btn-new-conv');
const btnRenameConv = document.getElementById('btn-rename-conv');
const btnDeleteConv = document.getElementById('btn-delete-conv');

// ── Utilities ──────────────────────────────────────────────────────────────
const delay = ms => new Promise(r => setTimeout(r, ms));

function makeId() {
  return 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function extractFirstCodeBlock(text) {
  const m = text.match(/```(?:typescript|ts|javascript|js)?\n?([\s\S]*?)```/);
  return m ? m[1].trim() : null;
}

// Parse AI response into { summary, next, detail }
// Expected format:
//   📋 summary line
//   ▶ next step line
//   ---
//   detail...
function parseAIResponse(text) {
  const lines = text.split('\n');
  let summaryLine = '';
  let nextLine = '';
  let detailStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('📋')) summaryLine = l.replace(/^📋\s*/, '').trim();
    else if (l.startsWith('▶')) nextLine = l.replace(/^▶\s*/, '').trim();
    else if (l.trim() === '---') { detailStart = i + 1; break; }
  }

  const detail = detailStart >= 0 ? lines.slice(detailStart).join('\n').trim() : '';

  // Fallback: if no markers, treat first paragraph as summary, rest as detail
  if (!summaryLine) {
    const sep = text.indexOf('\n\n');
    if (sep > 0) {
      summaryLine = text.slice(0, sep).trim();
      return { summary: summaryLine, next: '', detail: text.slice(sep + 2).trim() };
    }
    return { summary: text.trim(), next: '', detail: '' };
  }

  return { summary: summaryLine, next: nextLine, detail };
}

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  await window.platform.initArcadeView();
  if (window.platform.isMobile) initMobileTabs();
  const saved = await window.platform.settingsGet();
  if (saved && Object.keys(saved).length > 0) {
    settings = { ...settings, ...saved };
  }
  await loadConversationList();
  addWelcomeMessage();
}

function initMobileTabs() {
  document.body.classList.add('mobile');
  const tabsEl = document.getElementById('mobile-tabs');
  const arcadeContainer = document.getElementById('arcade-container');
  const aiPanelEl = document.getElementById('ai-panel');
  if (!tabsEl) return;
  tabsEl.classList.remove('hidden');

  document.getElementById('tab-editor').addEventListener('click', async () => {
    document.getElementById('tab-editor').classList.add('active');
    document.getElementById('tab-chat').classList.remove('active');
    aiPanelEl.classList.add('hidden');
    arcadeContainer.classList.remove('hidden');
    await window.platform.initArcadeView();
  });

  document.getElementById('tab-chat').addEventListener('click', async () => {
    document.getElementById('tab-chat').classList.add('active');
    document.getElementById('tab-editor').classList.remove('active');
    arcadeContainer.classList.add('hidden');
    aiPanelEl.classList.remove('hidden');
  });

  // Start on Editor tab
  aiPanelEl.classList.add('hidden');
}

function addWelcomeMessage() {
  addMessage('assistant',
    '📋 Welcome to MakeVibeCode Arcade! Open a project and type what you want to build.\n' +
    '▶ Go to Settings (gear icon) to add your AI API key first — click Help (?) for step-by-step instructions on getting a free one.\n\n' +
    '---\n\n' +
    'Each message will automatically: read your code → ask the AI → apply changes → fix errors → restore your view.\n\n' +
    'Use **Get Code** to manually pull the current editor contents into context.'
  );
}

// ── Settings ───────────────────────────────────────────────────────────────
btnSettings.addEventListener('click', openSettings);
btnCloseSettings.addEventListener('click', closeSettings);
settingsModal.querySelector('.modal-backdrop').addEventListener('click', closeSettings);

// ── Help ───────────────────────────────────────────────────────────────────
btnHelp.addEventListener('click', () => helpModal.classList.remove('hidden'));
btnCloseHelp.addEventListener('click', () => helpModal.classList.add('hidden'));
btnCloseHelpFooter.addEventListener('click', () => helpModal.classList.add('hidden'));
helpModal.querySelector('.modal-backdrop').addEventListener('click', () => helpModal.classList.add('hidden'));

async function copyToClipboard(text, feedbackEl) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    // Fallback for environments without Clipboard API permission
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  feedbackEl.classList.remove('hidden');
  setTimeout(() => feedbackEl.classList.add('hidden'), 1500);
}

btnCopyGeminiUrl.addEventListener('click', () =>
  copyToClipboard(helpGeminiUrl.textContent.trim(), helpCopyFeedback));

btnOpenGeminiUrl.addEventListener('click', () => {
  window.platform.openExternal(helpGeminiUrl.textContent.trim());
});

function openSettings() {
  document.getElementById('setting-provider').value = settings.provider;
  document.getElementById('setting-apikey').value = settings.apiKey;
  document.getElementById('setting-system-prompt').value = settings.systemPrompt;
  resetModelDropdown(settings.model);
  clearApiKeyTestStatus();
  settingsModal.classList.remove('hidden');
}

function closeSettings() { settingsModal.classList.add('hidden'); }

document.getElementById('setting-provider').addEventListener('change', () => {
  clearApiKeyTestStatus();
  resetModelDropdown('');
});
document.getElementById('setting-apikey').addEventListener('input', () => {
  clearApiKeyTestStatus();
  resetModelDropdown('');
});

function clearApiKeyTestStatus() {
  apikeyTestStatus.textContent = '';
  apikeyTestStatus.classList.remove('status-ok', 'status-error');
}

// Resets the dropdown to just "— Use default —", plus the currently saved
// model (if any) so switching Settings back open doesn't lose it — full
// list is only fetched by clicking Load Models.
function resetModelDropdown(currentModel) {
  settingModelSelect.innerHTML = '';
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '— Use default —';
  settingModelSelect.appendChild(defaultOpt);
  if (currentModel) {
    const opt = document.createElement('option');
    opt.value = currentModel;
    opt.textContent = `${currentModel} (current)`;
    settingModelSelect.appendChild(opt);
  }
  settingModelSelect.value = currentModel || '';
  document.getElementById('model-hint').textContent =
    'Click Load Models above to see available models for this provider.';
}

function populateModelDropdown(models) {
  if (!models || models.length === 0) {
    resetModelDropdown('');
    document.getElementById('model-hint').textContent =
      'No models returned for this provider — you can still use the default.';
    return;
  }
  const previousValue = settingModelSelect.value;
  settingModelSelect.innerHTML = '';
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '— Use default —';
  settingModelSelect.appendChild(defaultOpt);
  models.forEach(id => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    settingModelSelect.appendChild(opt);
  });
  settingModelSelect.value = models.includes(previousValue) ? previousValue : '';
  document.getElementById('model-hint').textContent = `${models.length} models available.`;
}

btnLoadModels.addEventListener('click', async () => {
  const provider = document.getElementById('setting-provider').value;
  const apiKey = document.getElementById('setting-apikey').value.trim();

  clearApiKeyTestStatus();
  if (!apiKey) {
    apikeyTestStatus.textContent = 'Enter an API key first.';
    apikeyTestStatus.classList.add('status-error');
    return;
  }

  btnLoadModels.disabled = true;
  btnLoadModels.textContent = 'Loading…';
  apikeyTestStatus.textContent = 'Checking connection…';

  try {
    const result = await window.platform.testApiKey({ provider, apiKey });
    if (result.ok) {
      const modelCount = result.models ? result.models.length : 0;
      apikeyTestStatus.textContent = modelCount > 0
        ? `✓ Connected — ${modelCount} models loaded below`
        : '✓ Connected successfully';
      apikeyTestStatus.classList.add('status-ok');
      populateModelDropdown(result.models);
    } else {
      apikeyTestStatus.textContent = `✗ ${result.error || 'Connection failed'}`;
      apikeyTestStatus.classList.add('status-error');
    }
  } catch (e) {
    apikeyTestStatus.textContent = `✗ ${e.message || 'Connection failed'}`;
    apikeyTestStatus.classList.add('status-error');
  } finally {
    btnLoadModels.disabled = false;
    btnLoadModels.textContent = 'Load Models';
  }
});

btnSaveSettings.addEventListener('click', async () => {
  settings.provider = document.getElementById('setting-provider').value;
  settings.apiKey = document.getElementById('setting-apikey').value.trim();
  settings.model = settingModelSelect.value;
  settings.systemPrompt = document.getElementById('setting-system-prompt').value.trim() || DEFAULT_SYSTEM_PROMPT;
  await window.platform.settingsSet(settings);
  closeSettings();
  addMessage('assistant', `📋 Settings saved — using ${settings.provider}${settings.model ? ' (' + settings.model + ')' : ''}.\n▶ Nothing, you're good!`);
});

// ── Conversation management ────────────────────────────────────────────────
async function loadConversationList() {
  const list = await window.platform.convList();
  convSelect.innerHTML = '';

  if (list.length === 0) {
    await createNewConversation(false);
    return;
  }

  list.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    convSelect.appendChild(opt);
  });

  // Load most recent (first in sorted list)
  if (!currentConv || !list.find(c => c.id === currentConv.id)) {
    await switchConversation(list[0].id);
  } else {
    convSelect.value = currentConv.id;
  }
}

async function switchConversation(id) {
  const conv = await window.platform.convLoad(id);
  if (!conv) return;
  currentConv = conv;
  conversationHistory = conv.messages || [];
  convSelect.value = id;
  messagesEl.innerHTML = '';
  if (conversationHistory.length === 0) {
    addWelcomeMessage();
  } else {
    // Re-render saved messages
    for (const msg of conversationHistory) {
      if (msg.role === 'user') addMessage('user', msg.displayContent || msg.content);
      else if (msg.role === 'assistant') addMessage('assistant', msg.content);
    }
  }
}

async function createNewConversation(switchTo = true) {
  const id = makeId();
  const conv = {
    id,
    name: 'New Conversation',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await window.platform.convSave(conv);

  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = conv.name;
  convSelect.insertBefore(opt, convSelect.firstChild);

  if (switchTo) {
    currentConv = conv;
    conversationHistory = [];
    convSelect.value = id;
    messagesEl.innerHTML = '';
    addWelcomeMessage();
  } else {
    currentConv = conv;
    conversationHistory = [];
  }
}

async function saveCurrentConversation() {
  if (!currentConv) return;
  currentConv.messages = conversationHistory;
  // Auto-name from first user message
  if (currentConv.name === 'New Conversation') {
    const firstUser = conversationHistory.find(m => m.role === 'user');
    if (firstUser) {
      const raw = firstUser.displayContent || firstUser.content;
      currentConv.name = raw.slice(0, 42).replace(/\n/g, ' ') + (raw.length > 42 ? '…' : '');
      // Update select option text
      const opt = convSelect.querySelector(`option[value="${currentConv.id}"]`);
      if (opt) opt.textContent = currentConv.name;
    }
  }
  await window.platform.convSave(currentConv);
}

convSelect.addEventListener('change', () => switchConversation(convSelect.value));

btnNewConv.addEventListener('click', () => createNewConversation(true));

btnRenameConv.addEventListener('click', () => {
  if (!currentConv) return;
  convRenameInput.value = currentConv.name;
  convSelect.classList.add('hidden');
  convRenameInput.classList.remove('hidden');
  convRenameInput.focus();
  convRenameInput.select();
});

let renameCancelled = false;

async function commitRename() {
  const name = convRenameInput.value.trim();
  convRenameInput.classList.add('hidden');
  convSelect.classList.remove('hidden');
  if (!name || !currentConv) return;
  currentConv.name = name;
  const opt = convSelect.querySelector(`option[value="${currentConv.id}"]`);
  if (opt) opt.textContent = name;
  await saveCurrentConversation();
}

convRenameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); convRenameInput.blur(); }
  if (e.key === 'Escape') {
    // Hiding the input below forces a blur — set the flag first so the blur
    // handler skips committing whatever was typed and just cancels instead.
    renameCancelled = true;
    convRenameInput.classList.add('hidden');
    convSelect.classList.remove('hidden');
  }
});
convRenameInput.addEventListener('blur', () => {
  if (renameCancelled) { renameCancelled = false; return; }
  commitRename();
});

btnDeleteConv.addEventListener('click', async () => {
  if (!currentConv) return;
  if (!confirm(`Delete "${currentConv.name}"?`)) return;
  await window.platform.convDelete(currentConv.id);
  const opt = convSelect.querySelector(`option[value="${currentConv.id}"]`);
  if (opt) opt.remove();
  currentConv = null;
  if (convSelect.options.length > 0) {
    await switchConversation(convSelect.options[0].value);
  } else {
    await createNewConversation(true);
  }
});

// ── Panel toggle & resizer ─────────────────────────────────────────────────
btnTogglePanel.addEventListener('click', () => {
  panelVisible = !panelVisible;
  aiPanel.classList.toggle('hidden', !panelVisible);
  resizer.classList.toggle('hidden', !panelVisible);
});

let isResizing = false, startX, startW;

resizer.addEventListener('mousedown', e => {
  isResizing = true; startX = e.clientX; startW = aiPanel.offsetWidth;
  resizer.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});
document.addEventListener('mousemove', e => {
  if (!isResizing) return;
  aiPanel.style.width = Math.max(280, Math.min(600, startW + startX - e.clientX)) + 'px';
});
document.addEventListener('mouseup', () => {
  if (!isResizing) return;
  isResizing = false; resizer.classList.remove('dragging');
  document.body.style.cursor = ''; document.body.style.userSelect = '';
});

// ── MakeCode webview JS helpers ────────────────────────────────────────────
// Helper functions injected into every wvRun call.
// These run inside arcade.makecode.com's JS context via executeJavaScript /
// MakeCodeBridge.executeScript — they have no access to app.js variables.
const HELPERS_BLOCK = `
    function getMonaco(w) {
      if (!w) return null;
      if (w.monaco && w.monaco.editor) return w.monaco;
      try {
        if (w.require && w.require.s && w.require.s.contexts && w.require.s.contexts._) {
          const def = w.require.s.contexts._.defined;
          for (const k of Object.keys(def)) {
            const mod = def[k];
            if (mod && mod.editor && typeof mod.editor.getModels === 'function') return mod;
          }
        }
      } catch(e) {}
      try { const m = w.require('vs/editor/editor.main'); if (m && m.editor) return m; } catch(e) {}
      try {
        for (const k of Object.keys(w)) {
          try { const v = w[k]; if (v && v.editor && typeof v.editor.getModels === 'function') return v; } catch(e) {}
        }
      } catch(e) {}
      return null;
    }
    function findMonaco() {
      const top = getMonaco(window);
      if (top) return { monaco: top, src: 'top' };
      for (const fr of [...document.querySelectorAll('iframe')]) {
        try { const m = getMonaco(fr.contentWindow); if (m) return { monaco: m, src: fr.src || 'iframe' }; } catch(e) {}
      }
      return null;
    }
    function findTsModel(monaco) {
      const models = monaco.editor.getModels();
      if (!models.length) return null;
      return models.find(m => /main\\.ts$/i.test(m.uri.path) || /main\\.ts$/i.test(m.uri.toString()))
          || models.find(m => /\\.ts$/i.test(m.uri.path) || /\\.ts$/i.test(m.uri.toString()))
          || models.find(m => { try { return (m.getLanguageId ? m.getLanguageId() : m.getModeId()) === 'typescript'; } catch { return false; }})
          || models.reduce((a, b) => a.getValue().length >= b.getValue().length ? a : b);
    }
    function findPxtEditor() {
      function search(fiber, depth) {
        if (!fiber || depth > 800) return null;
        try {
          const sn = fiber.stateNode;
          if (sn && typeof sn.openTypeScriptAsync === 'function') return sn;
          if (sn && typeof sn.typecheckNow === 'function') return sn;
        } catch(e) {}
        return search(fiber.child, depth + 1) || search(fiber.sibling, depth + 1);
      }
      const roots = [
        document.getElementById('content'),
        document.getElementById('root'),
        document.body && document.body.firstElementChild,
        document.body,
      ].filter(Boolean);
      for (const el of roots) {
        const key = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
        if (!key) continue;
        const result = search(el[key], 0);
        if (result) return result;
      }
      return null;
    }
    function findActiveMonacoModel() {
      const f = findMonaco();
      if (!f) return null;
      if (f.monaco.editor.getEditors) {
        const editors = f.monaco.editor.getEditors();
        const ed = editors.find(e => { try { return e.hasTextFocus && e.hasTextFocus(); } catch { return false; }})
                || editors.find(e => { try { const m = e.getModel(); return m && /\\.ts$/i.test(m.uri.toString()); } catch { return false; }})
                || editors[0];
        if (ed) { const m = ed.getModel(); if (m) return { model: m, editor: ed, monaco: f.monaco }; }
      }
      const m = findTsModel(f.monaco);
      return m ? { model: m, editor: null, monaco: f.monaco } : null;
    }
`;

async function wvRun(script) {
  return window.platform.wvRun(
    HELPERS_BLOCK + '\nreturn (async function() {\n' + script + '\n})();'
  );
}

// ── MakeCode: view detection & switching ───────────────────────────────────
async function detectView() {
  try {
    return await wvRun(`
      // 1. React fiber editor state (most reliable)
      const ed = findPxtEditor();
      if (ed && ed.state) {
        const st = ed.state;
        // PXT EditorState enum: 0=Blocks, 1=TypeScript, 2=Text, 3=JavaScript
        if (st.editorState === 1 || st.editorState === 3) return 'javascript';
        if (st.editorState === 0) return 'blocks';
        // Some PXT versions use a string or nested object
        if (st.header && st.editor) {
          const e = st.editor;
          if (typeof e === 'string') {
            if (e.includes('typescript') || e.includes('javascript')) return 'javascript';
            if (e.includes('blocks')) return 'blocks';
          }
        }
      }
      // 2. DOM presence: Monaco editor element
      if (document.querySelector('.monaco-editor') &&
          document.querySelector('.monaco-editor').getBoundingClientRect().height > 10) return 'javascript';
      // 3. DOM presence: Blockly (any variant)
      const bSel = '.blocklyDiv,.blocksEditor,.blocklySvg,.blocklyWidgetDiv';
      const bEl = document.querySelector(bSel);
      if (bEl && bEl.getBoundingClientRect().height > 10) return 'blocks';
      // 4. Active tab/toggle text
      for (const el of document.querySelectorAll('*')) {
        if (!el.offsetParent) continue;
        const txt = (el.textContent || '').trim().toLowerCase();
        if (txt.length > 20 || txt.length === 0) continue;
        const isActive = el.classList.contains('active') || el.classList.contains('selected')
                      || el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true';
        if (!isActive) continue;
        if (txt === 'javascript' || txt === 'typescript' || txt === 'js') return 'javascript';
        if (txt === 'blocks' || txt === 'block') return 'blocks';
      }
      return 'unknown';
    `);
  } catch { return 'unknown'; }
}

async function switchView(target) {
  const t = JSON.stringify(target);
  try {
    return await wvRun(`
      const _t = ${t};
      // 1. React fiber editor — this is the real editor component
      const ed = findPxtEditor();
      if (ed) {
        try {
          if (_t === 'javascript' && typeof ed.openTypeScriptAsync === 'function') {
            await ed.openTypeScriptAsync();
            return true;
          }
          if (_t === 'blocks' && typeof ed.openBlocksAsync === 'function') {
            await ed.openBlocksAsync();
            return true;
          }
        } catch(e) {}
      }
      // 2. Click any visible element with matching text
      const re = _t === 'javascript' ? /^(javascript|typescript|js|ts)$/i : /^blocks?$/i;
      for (const el of [...document.querySelectorAll('*')]) {
        if (!el.offsetParent) continue;
        const tag = el.tagName;
        if (!['A','BUTTON','SPAN','DIV','LI'].includes(tag)) continue;
        const label = (el.textContent || el.title || el.getAttribute('aria-label') || '').trim();
        if (re.test(label) && label.length <= 15) { el.click(); return true; }
      }
      return false;
    `);
  } catch { return false; }
}

// Wait for Monaco to actually appear in the DOM (after switching to JS view)
async function waitForMonacoInDOM(ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const found = await window.platform.wvEval(
      `!!(document.querySelector('.monaco-editor') && document.querySelector('.monaco-editor').getBoundingClientRect().height > 10)`
    );
    if (found) return true;
    await delay(300);
  }
  return false;
}

async function waitForView(target, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await detectView() === target) return true;
    await delay(300);
  }
  return false;
}

// ── MakeCode: code read / write / errors ───────────────────────────────────
async function getEditorCode() {
  try {
    const raw = await wvRun(`
      const am = findActiveMonacoModel();
      if (am) return JSON.stringify({code: am.model.getValue()});
      const f = findMonaco();
      if (f) {
        const m = findTsModel(f.monaco);
        if (m) return JSON.stringify({code: m.getValue()});
      }
      return JSON.stringify({code: null});
    `);
    return JSON.parse(raw).code || null;
  } catch { return null; }
}

async function applyCodeToArcade(code) {
  try {
    const result = await wvRun(`
      const c = ${JSON.stringify(code)};

      // Only write to the ACTIVE editor model — the one the UI is actually showing.
      // Using findActiveMonacoModel() picks the editor instance's current model,
      // not a background type-checking model.
      const am = findActiveMonacoModel();
      if (am) {
        try {
          if (am.editor) {
            am.editor.executeEdits('makevibecode', [{range: am.model.getFullModelRange(), text: c, forceMoveMarkers: true}]);
            am.editor.pushUndoStop();
            return {ok: true, method: 'executeEdits-active'};
          }
          am.model.setValue(c);
          return {ok: true, method: 'setValue-active'};
        } catch(e) {}
      }

      // Fallback: use React fiber editor to update the file through PXT's own API
      const ed = findPxtEditor();
      if (ed) {
        // Try various PXT ProjectView methods for updating file content
        if (typeof ed.saveTypeScriptAsync === 'function') {
          try { await ed.saveTypeScriptAsync(c); return {ok: true, method: 'pxt-saveTypeScriptAsync'}; } catch(e) {}
        }
        if (typeof ed.updateFileAsync === 'function') {
          try { await ed.updateFileAsync('main.ts', c); return {ok: true, method: 'pxt-updateFileAsync'}; } catch(e) {}
        }
        // Expose what's available on the editor component for diagnostics
        const edMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(ed))
          .filter(k => typeof ed[k] === 'function').slice(0, 40);
        return {ok: false, pxtEditorMethods: edMethods};
      }

      // Full diagnostics when nothing works
      const amdKeys = [];
      try {
        if (window.require && window.require.s && window.require.s.contexts && window.require.s.contexts._) {
          for (const k of Object.keys(window.require.s.contexts._.defined)) {
            if (k.includes('editor') || k.includes('monaco')) amdKeys.push(k);
          }
        }
      } catch(e) {}
      return {
        ok: false,
        pageUrl: location.href,
        foundMonaco: !!findMonaco(),
        foundPxtEditor: !!findPxtEditor(),
        domHasMonacoEl: !!document.querySelector('.monaco-editor'),
        amdKeys,
        pxtKeys: window.pxt ? Object.keys(window.pxt) : [],
        visibleIds: [...document.querySelectorAll('[id]')].filter(e => e.offsetParent).slice(0,15).map(e => e.id),
      };
    `);
    if (result?.ok) return true;
    return result;
  } catch(e) {
    return {ok: false, error: e.message};
  }
}

async function getEditorErrors() {
  try {
    const raw = await wvRun(`
      const f = findMonaco();
      if (!f) return '[]';
      return JSON.stringify(f.monaco.editor.getModelMarkers({})
        .filter(m=>m.severity===8)
        .map(m=>'Line '+m.startLineNumber+': '+m.message));
    `);
    return JSON.parse(raw);
  } catch { return []; }
}

async function waitForErrorsToSettle() {
  await delay(ERROR_SETTLE_MS);
  let prev = -1;
  for (let i = 0; i < 4; i++) {
    const errs = await getEditorErrors();
    if (errs.length === prev) return errs;
    prev = errs.length;
    await delay(600);
  }
  return getEditorErrors();
}

// ── Pipeline status bubble ─────────────────────────────────────────────────
class PipelineStatus {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'message pipeline-status';
    this.el.innerHTML = `<div class="message-role">Auto</div>
      <div class="pipeline-bubble">
        <div class="pipeline-step-row working">
          <span class="pipeline-spinner"></span>
          <span class="pipeline-text">Starting…</span>
        </div>
      </div>`;
    messagesEl.appendChild(this.el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  update(text, state = 'working') {
    const row = this.el.querySelector('.pipeline-step-row');
    const spinner = this.el.querySelector('.pipeline-spinner');
    const textEl = this.el.querySelector('.pipeline-text');
    if (!row || !textEl) return;
    row.className = 'pipeline-step-row ' + state;
    textEl.textContent = text;
    spinner.style.display = state === 'working' ? '' : 'none';
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  done(text) { this.update(text, 'done'); }
  warn(text) { this.update(text, 'warn'); }
  error(text) { this.update(text, 'error'); }
}

// ── AI call ────────────────────────────────────────────────────────────────
async function callAI(messages) {
  return window.platform.aiRequest({
    provider: settings.provider,
    config: { apiKey: settings.apiKey, model: settings.model },
    messages: messages.slice(-20).map(({ role, content }) => ({ role, content })),
    systemPrompt: settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
  });
}

function addThinkingEl() {
  const el = document.createElement('div');
  el.className = 'message assistant';
  el.innerHTML = `<div class="message-role">AI</div>
    <div class="thinking"><div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div><span>Thinking…</span></div>`;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

// ── Vibe coding pipeline ───────────────────────────────────────────────────
async function vibeCodingPipeline(userText) {
  const status = new PipelineStatus();
  let wasOnBlocks = false;

  try {
    status.update('Detecting editor view…');
    const view = await detectView();
    wasOnBlocks = view === 'blocks' || view === 'unknown';

    // Always ensure we're in JavaScript view before touching Monaco
    if (view !== 'javascript') {
      status.update('Switching to JavaScript view…');
      await switchView('javascript');
      // Wait for Monaco to physically appear in the DOM — not just the hash change
      const monacoReady = await waitForMonacoInDOM(9000);
      if (!monacoReady) {
        status.warn('Could not switch to JavaScript view — make sure a project is open in MakeCode');
        return;
      }
    }

    status.update('Reading current code…');
    const code = await getEditorCode();
    if (code) {
      attachedCode = code;
      contextLabel.textContent = `Code attached — ${code.length} chars`;
      codeContextBar.classList.remove('hidden');
    }

    status.update('Asking AI…');
    const userContent = code
      ? `${userText}\n\nCurrent code:\n\`\`\`typescript\n${code}\n\`\`\``
      : userText;
    conversationHistory.push({ role: 'user', content: userContent, displayContent: userText });

    const thinkEl = addThinkingEl();
    let aiResult;
    try { aiResult = await callAI(conversationHistory); }
    finally { thinkEl.remove(); }

    const aiText = aiResult.text;
    conversationHistory.push({ role: 'assistant', content: aiText });
    addMessage('assistant', aiText);

    const newCode = extractFirstCodeBlock(aiText);
    if (!newCode) {
      status.done('Done — no code changes');
      await saveCurrentConversation();
      if (wasOnBlocks) await restoreBlocks(status);
      return;
    }

    status.update('Applying code…');
    const applyResult = await applyCodeToArcade(newCode);
    if (applyResult !== true) {
      // applyResult is a diagnostic object — show it in chat so it can be reported
      const diagStr = applyResult ? JSON.stringify(applyResult, null, 2) : 'unknown error';
      status.warn('Could not apply code — see details below');
      addMessage('error',
        `📋 Code apply failed.\n▶ Copy the diagnostics below and share them.\n\n---\n\n\`\`\`json\n${diagStr}\n\`\`\``
      );
      await saveCurrentConversation();
      if (wasOnBlocks) await restoreBlocks(status);
      return;
    }
    attachedCode = newCode;

    // Error iteration loop
    let iteration = 0;
    while (iteration < MAX_ERROR_ITERATIONS) {
      const label = iteration > 0 ? ` (fix ${iteration}/${MAX_ERROR_ITERATIONS})` : '';
      status.update(`Checking for errors${label}…`);
      const errors = await waitForErrorsToSettle();

      if (errors.length === 0) {
        status.done('✓ Applied — no errors');
        break;
      }

      iteration++;
      if (iteration >= MAX_ERROR_ITERATIONS) {
        status.warn(`⚠ ${errors.length} error(s) remain after ${MAX_ERROR_ITERATIONS} fix attempts`);
        conversationHistory.push({
          role: 'assistant',
          content: `📋 ${errors.length} error(s) could not be auto-fixed.\n▶ Review the errors below and ask me to fix a specific one.\n\n---\n\nErrors:\n${errors.map(e => '- ' + e).join('\n')}`,
        });
        addMessage('assistant', conversationHistory[conversationHistory.length - 1].content);
        break;
      }

      status.update(`Found ${errors.length} error(s) — fixing…`);
      const fixPrompt = `${errors.length} TypeScript error(s) need fixing:\n${errors.map(e => '- ' + e).join('\n')}\n\nProvide the complete corrected TypeScript file.`;
      conversationHistory.push({ role: 'user', content: fixPrompt, displayContent: fixPrompt });

      const fixEl = addThinkingEl();
      let fixResult;
      try { fixResult = await callAI(conversationHistory); }
      finally { fixEl.remove(); }

      conversationHistory.push({ role: 'assistant', content: fixResult.text });
      addMessage('assistant', fixResult.text);

      const fixedCode = extractFirstCodeBlock(fixResult.text);
      if (!fixedCode) { status.warn('AI did not return a code block'); break; }
      status.update(`Applying fix ${iteration}…`);
      if (await applyCodeToArcade(fixedCode) === true) attachedCode = fixedCode;
    }

    await saveCurrentConversation();
    if (wasOnBlocks) await restoreBlocks(status);

  } catch (err) {
    status.error(`Error: ${err.message}`);
  }
}

async function restoreBlocks(status) {
  status.update('Restoring Blocks view…');
  await switchView('blocks');
  const ok = await waitForView('blocks', 6000);
  ok ? status.done('✓ Done — Blocks view restored') : status.warn('✓ Done — could not restore Blocks view');
}

// ── Manual Get Code button ─────────────────────────────────────────────────
btnGetCode.addEventListener('click', async () => {
  btnGetCode.disabled = true;
  btnGetCode.textContent = 'Fetching…';
  try {
    const code = await getEditorCode();
    if (code) {
      attachedCode = code;
      contextLabel.textContent = `Code attached — ${code.length} chars`;
      codeContextBar.classList.remove('hidden');
      addMessage('assistant', `📋 Got your code (${code.length} chars).\n▶ Tell me what you'd like to change.`);
    } else {
      addMessage('error', `Could not read code — make sure you're in the JavaScript view with a project open.`);
    }
  } catch (err) {
    addMessage('error', `Error reading code: ${err.message}`);
  } finally {
    btnGetCode.disabled = false;
    btnGetCode.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> Get Code`;
  }
});

btnRemoveContext.addEventListener('click', () => {
  attachedCode = null;
  codeContextBar.classList.add('hidden');
});

// ── Message rendering ──────────────────────────────────────────────────────
function addMessage(role, content) {
  const msgEl = document.createElement('div');
  msgEl.className = `message ${role}`;

  const roleLabel = document.createElement('div');
  roleLabel.className = 'message-role';
  roleLabel.textContent = role === 'user' ? 'You' : role === 'assistant' ? 'AI' : 'Error';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  if (role === 'assistant') {
    const { summary, next, detail } = parseAIResponse(content);
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'msg-summary';

    if (summary) {
      const sLine = document.createElement('div');
      sLine.className = 'msg-summary-line';
      sLine.innerHTML = renderMarkdown(summary);
      summaryDiv.appendChild(sLine);
    }
    if (next) {
      const nLine = document.createElement('div');
      nLine.className = 'msg-summary-line';
      nLine.style.color = 'var(--text-muted)';
      nLine.style.fontSize = '12px';
      nLine.innerHTML = '▶ ' + renderMarkdown(next);
      summaryDiv.appendChild(nLine);
    }

    bubble.appendChild(summaryDiv);

    if (detail) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'msg-toggle';
      toggle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg> Details`;

      const detailDiv = document.createElement('div');
      detailDiv.className = 'msg-detail';
      detailDiv.innerHTML = renderMarkdown(detail);

      // Apply buttons on code blocks inside detail
      detailDiv.querySelectorAll('pre[data-lang="typescript"],pre[data-lang="ts"],pre[data-lang="javascript"]').forEach(pre => {
        const code = pre.querySelector('code');
        if (!code) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'apply-code-btn';
        btn.innerHTML = '▶ Apply to Editor';
        btn.addEventListener('click', async () => {
          const ok = await applyCodeToArcade(code.textContent);
          btn.textContent = ok ? '✓ Applied!' : '⚠ Could not apply';
          if (ok) btn.classList.add('applied');
        });
        pre.after(btn);
      });

      toggle.addEventListener('click', () => {
        const open = detailDiv.classList.toggle('open');
        toggle.classList.toggle('open', open);
        toggle.innerHTML = open
          ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg> Hide details`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg> Details`;
      });

      bubble.appendChild(toggle);
      bubble.appendChild(detailDiv);
    }
  } else {
    // User and error messages rendered as-is
    bubble.innerHTML = renderMarkdown(content);
  }

  msgEl.appendChild(roleLabel);
  msgEl.appendChild(bubble);
  messagesEl.appendChild(msgEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return msgEl;
}

function renderMarkdown(text) {
  let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre data-lang="${(lang||'').toLowerCase()}"><code>${code.trimEnd()}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/^#{1,3} (.+)$/gm, '<strong>$1</strong>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/\n/g, '<br>');
  html = html.replace(/<pre[^>]*>[\s\S]*?<\/pre>/g, m => m.replace(/<br>/g, '\n'));
  return html;
}

// ── Send message ───────────────────────────────────────────────────────────
btnSend.addEventListener('click', sendMessage);
userInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || isRequesting) return;
  if (!settings.apiKey) {
    addMessage('error', 'No API key configured. Click the gear icon to open Settings.');
    return;
  }
  addMessage('user', text);
  userInput.value = '';
  userInput.style.height = 'auto';
  isRequesting = true;
  btnSend.disabled = true;
  try {
    await vibeCodingPipeline(text);
  } finally {
    isRequesting = false;
    btnSend.disabled = false;
    userInput.focus();
  }
}

// ── Clear chat ─────────────────────────────────────────────────────────────
btnClearChat.addEventListener('click', async () => {
  conversationHistory = [];
  messagesEl.innerHTML = '';
  if (currentConv) {
    currentConv.messages = [];
    await window.platform.convSave(currentConv);
  }
  addWelcomeMessage();
});

// ── Auto-resize textarea ───────────────────────────────────────────────────
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 160) + 'px';
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });

// ── Webview sizing (Electron only) ─────────────────────────────────────────
function sizeWebview() {
  if (!window.platform || !window.platform.isElectron) return;
  const wv = document.getElementById('arcade-webview');
  const container = document.getElementById('arcade-container');
  if (!wv || !container) return;
  const { width, height } = container.getBoundingClientRect();
  if (width > 0 && height > 0) {
    wv.style.width = width + 'px';
    wv.style.height = height + 'px';
  }
}
const containerObserver = new ResizeObserver(sizeWebview);
containerObserver.observe(document.getElementById('arcade-container'));
window.addEventListener('resize', sizeWebview);

// ── Boot ───────────────────────────────────────────────────────────────────
init();
