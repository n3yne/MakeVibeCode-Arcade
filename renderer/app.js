// MakeVibeCode Arcade - AI Chat Panel Logic

const DEFAULT_SYSTEM_PROMPT = `You are an AI assistant for MakeCode Arcade game development. Your responses are shown in a collapsed view, so ALWAYS use this exact format:

📋 [One sentence: what you did or what the code does]
▶ [One sentence: what the user should do or check next — or "Nothing, you're good!" if done]

---

[Full technical details, explanation, and code blocks go here — this section is hidden by default]

Rules:
- The summary lines (📋 and ▶) must be the very first two lines, each on its own line
- Put ALL code blocks after the --- separator, never before it
- Always output the COMPLETE TypeScript file in a single \`\`\`typescript block after ---
- Never output partial snippets — full file only
- MakeCode Arcade uses a subset of TypeScript; avoid advanced TS features

Key MakeCode Arcade APIs:
- sprites.create(img\`...\`, SpriteKind.Player)
- controller.moveSprite(mySprite, 100, 100)
- scene.setBackgroundColor(color)
- info.setScore(0), info.setLife(3)
- game.onUpdate(() => { })
- sprites.onOverlap(SpriteKind.A, SpriteKind.B, (a, b) => { })`;

const MODEL_HINTS = {
  anthropic: 'e.g. claude-sonnet-4-6, claude-opus-4-8, claude-haiku-4-5-20251001',
  openai: 'e.g. gpt-4o, gpt-4o-mini, o1-mini',
  google: 'e.g. gemini-2.0-flash, gemini-1.5-pro',
  openrouter: 'e.g. anthropic/claude-sonnet-4-6, openai/gpt-4o, google/gemini-2.0-flash',
};

const MAX_ERROR_ITERATIONS = 3;
const ERROR_SETTLE_MS = 2500;

// ── State ──────────────────────────────────────────────────────────────────
let settings = {
  provider: 'anthropic',
  apiKey: '',
  model: '',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};
let conversationHistory = [];
let attachedCode = null;
let isRequesting = false;
let panelVisible = true;

// Current conversation
let currentConv = null; // { id, name, messages, createdAt, updatedAt }

// ── DOM refs ───────────────────────────────────────────────────────────────
const webview = document.getElementById('arcade-webview');
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
  const saved = await window.electronAPI.settingsGet();
  if (saved && Object.keys(saved).length > 0) {
    settings = { ...settings, ...saved };
  }
  await loadConversationList();
  addWelcomeMessage();
}

function addWelcomeMessage() {
  addMessage('assistant',
    '📋 Welcome to MakeVibeCode Arcade! Open a project and type what you want to build.\n' +
    '▶ Go to Settings (gear icon) to add your AI API key first.\n\n' +
    '---\n\n' +
    'Each message will automatically: read your code → ask the AI → apply changes → fix errors → restore your view.\n\n' +
    'Use **Get Code** to manually pull the current editor contents into context.'
  );
}

// ── Settings ───────────────────────────────────────────────────────────────
btnSettings.addEventListener('click', openSettings);
btnCloseSettings.addEventListener('click', closeSettings);
settingsModal.querySelector('.modal-backdrop').addEventListener('click', closeSettings);

function openSettings() {
  document.getElementById('setting-provider').value = settings.provider;
  document.getElementById('setting-apikey').value = settings.apiKey;
  document.getElementById('setting-model').value = settings.model;
  document.getElementById('setting-system-prompt').value = settings.systemPrompt;
  updateModelHint(settings.provider);
  settingsModal.classList.remove('hidden');
}

function closeSettings() { settingsModal.classList.add('hidden'); }

document.getElementById('setting-provider').addEventListener('change', e => updateModelHint(e.target.value));

function updateModelHint(provider) {
  document.getElementById('model-hint').textContent = MODEL_HINTS[provider] || '';
}

btnSaveSettings.addEventListener('click', async () => {
  settings.provider = document.getElementById('setting-provider').value;
  settings.apiKey = document.getElementById('setting-apikey').value.trim();
  settings.model = document.getElementById('setting-model').value.trim();
  settings.systemPrompt = document.getElementById('setting-system-prompt').value.trim() || DEFAULT_SYSTEM_PROMPT;
  await window.electronAPI.settingsSet(settings);
  closeSettings();
  addMessage('assistant', `📋 Settings saved — using ${settings.provider}${settings.model ? ' (' + settings.model + ')' : ''}.\n▶ Nothing, you're good!`);
});

// ── Conversation management ────────────────────────────────────────────────
async function loadConversationList() {
  const list = await window.electronAPI.convList();
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
  const conv = await window.electronAPI.convLoad(id);
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
  await window.electronAPI.convSave(conv);

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
  await window.electronAPI.convSave(currentConv);
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
  if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
  if (e.key === 'Escape') {
    convRenameInput.classList.add('hidden');
    convSelect.classList.remove('hidden');
  }
});
convRenameInput.addEventListener('blur', commitRename);

btnDeleteConv.addEventListener('click', async () => {
  if (!currentConv) return;
  if (!confirm(`Delete "${currentConv.name}"?`)) return;
  await window.electronAPI.convDelete(currentConv.id);
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

// ── MakeCode: view detection & switching ───────────────────────────────────
async function detectView() {
  if (!webview) return 'unknown';
  try {
    return await webview.executeJavaScript(`(function(){
      const monacoEl = document.querySelector('.monaco-editor');
      const blocklyEl = document.querySelector('.blocklyDiv,.blocksEditor');
      const mV = monacoEl && monacoEl.getBoundingClientRect().height > 10;
      const bV = blocklyEl && blocklyEl.getBoundingClientRect().height > 10;
      if (mV && !bV) return 'javascript';
      if (bV && !mV) return 'blocks';
      if (mV) return 'javascript';
      const tabs = [...document.querySelectorAll('[class*="toggle"],[role="tab"],.item.tab')];
      for (const t of tabs) {
        if (!t.offsetParent) continue;
        const active = t.classList.contains('active') || t.classList.contains('selected') || t.getAttribute('aria-selected')==='true';
        if (!active) continue;
        const txt = (t.textContent||'').toLowerCase();
        if (txt.includes('javascript')||txt.includes('typescript')) return 'javascript';
        if (txt.includes('block')) return 'blocks';
      }
      return 'unknown';
    })()`);
  } catch { return 'unknown'; }
}

async function switchView(target) {
  if (!webview) return false;
  try {
    return await webview.executeJavaScript(`(function(t){
      try {
        if (window.pxt && pxt.editor) {
          if (t==='javascript' && typeof pxt.editor.openTypeScriptAsync==='function') { pxt.editor.openTypeScriptAsync(); return true; }
          if (t==='blocks' && typeof pxt.editor.openBlocksAsync==='function') { pxt.editor.openBlocksAsync(); return true; }
        }
      } catch(e){}
      const re = t==='javascript' ? /^(javascript|typescript|js|ts)$/i : /^blocks?$/i;
      for (const el of [...document.querySelectorAll('a,button,[role="tab"],[role="button"],.item')]) {
        if (!el.offsetParent) continue;
        const label = (el.textContent||el.title||el.getAttribute('aria-label')||'').trim();
        if (re.test(label) && label.length < 20) { el.click(); return true; }
      }
      return false;
    })(${JSON.stringify(target)})`);
  } catch { return false; }
}

async function waitForView(target, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await detectView() === target) return true;
    await delay(300);
  }
  return false;
}

// ── MakeCode: code read / write / errors ───────────────────────────────────
async function getEditorCode() {
  if (!webview) return null;
  try {
    const raw = await webview.executeJavaScript(`(function(){
      try {
        if (window.monaco && monaco.editor) {
          const m = monaco.editor.getModels().find(m => m.uri.path.endsWith('.ts')||m.uri.path.endsWith('main.ts'));
          if (m) return JSON.stringify({code: m.getValue()});
        }
      } catch(e){}
      try {
        if (window.pxt && pxt.editor && pxt.editor.getEditorState) {
          const s = pxt.editor.getEditorState();
          if (s) return JSON.stringify({code: typeof s==='string'?s:JSON.stringify(s)});
        }
      } catch(e){}
      return JSON.stringify({code:null});
    })()`);
    return JSON.parse(raw).code || null;
  } catch { return null; }
}

async function applyCodeToArcade(code) {
  if (!webview) return false;
  try {
    const r = await webview.executeJavaScript(`(function(c){
      try {
        if (window.monaco && monaco.editor) {
          const m = monaco.editor.getModels().find(m => m.uri.path.endsWith('.ts'));
          if (m) { m.pushEditOperations([],[{range:m.getFullModelRange(),text:c}],()=>null); return true; }
        }
      } catch(e){}
      try {
        if (window.pxt && pxt.editor && pxt.editor.setFile) { pxt.editor.setFile('main.ts',c); return true; }
      } catch(e){}
      return false;
    })(${JSON.stringify(code)})`);
    return !!r;
  } catch { return false; }
}

async function getEditorErrors() {
  if (!webview) return [];
  try {
    const raw = await webview.executeJavaScript(`(function(){
      try {
        if (!window.monaco) return '[]';
        return JSON.stringify(monaco.editor.getModelMarkers({})
          .filter(m=>m.severity===8)
          .map(m=>'Line '+m.startLineNumber+': '+m.message));
      } catch(e){ return '[]'; }
    })()`);
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
  return window.electronAPI.aiRequest({
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
    wasOnBlocks = view === 'blocks';

    if (wasOnBlocks) {
      status.update('Switching to JavaScript view…');
      await switchView('javascript');
      await waitForView('javascript', 7000);
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
    const applied = await applyCodeToArcade(newCode);
    if (!applied) {
      status.warn('Could not apply code — check editor');
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
      await applyCodeToArcade(fixedCode);
      attachedCode = fixedCode;
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
  if (!webview) return;
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
    await window.electronAPI.convSave(currentConv);
  }
  addWelcomeMessage();
});

// ── Auto-resize textarea ───────────────────────────────────────────────────
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 160) + 'px';
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });

// ── Webview sizing ─────────────────────────────────────────────────────────
function sizeWebview() {
  const container = document.getElementById('arcade-container');
  if (!webview || !container) return;
  const { width, height } = container.getBoundingClientRect();
  if (width > 0 && height > 0) {
    webview.style.width = width + 'px';
    webview.style.height = height + 'px';
  }
}
const containerObserver = new ResizeObserver(sizeWebview);
containerObserver.observe(document.getElementById('arcade-container'));
window.addEventListener('resize', sizeWebview);
sizeWebview();

// ── Boot ───────────────────────────────────────────────────────────────────
init();
