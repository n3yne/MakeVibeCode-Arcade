const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1000,
    minHeight: 600,
    title: 'MakeVibeCode Arcade',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      sandbox: false,
    },
    backgroundColor: '#1e1e2e',
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Allow webview to load arcade.makecode.com
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src * 'unsafe-inline' 'unsafe-eval' data: blob:"],
      },
    });
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

// Proxy AI API calls from renderer to avoid CORS issues
ipcMain.handle('ai-request', async (event, { provider, config, messages, systemPrompt }) => {
  return new Promise((resolve, reject) => {
    let options;
    let body;

    switch (provider) {
      case 'openai':
        body = JSON.stringify({
          model: config.model || 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages,
          ],
          temperature: 0.7,
        });
        options = {
          hostname: 'api.openai.com',
          path: '/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Length': Buffer.byteLength(body),
          },
        };
        break;

      case 'anthropic':
        body = JSON.stringify({
          model: config.model || 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: systemPrompt,
          messages,
        });
        options = {
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(body),
          },
        };
        break;

      case 'google':
        body = JSON.stringify({
          contents: messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { temperature: 0.7 },
        });
        const googleModel = config.model || 'gemini-2.0-flash';
        options = {
          hostname: 'generativelanguage.googleapis.com',
          path: `/v1beta/models/${googleModel}:generateContent?key=${config.apiKey}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        };
        break;

      case 'openrouter':
        body = JSON.stringify({
          model: config.model || 'anthropic/claude-sonnet-4-6',
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages,
          ],
          temperature: 0.7,
        });
        options = {
          hostname: 'openrouter.ai',
          path: '/api/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
            'HTTP-Referer': 'https://makevibecode.app',
            'X-Title': 'MakeVibeCode Arcade',
            'Content-Length': Buffer.byteLength(body),
          },
        };
        break;

      default:
        return reject(new Error(`Unknown provider: ${provider}`));
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          let text = '';

          if (provider === 'anthropic') {
            text = parsed.content?.[0]?.text || parsed.error?.message || 'No response';
          } else if (provider === 'google') {
            text = parsed.candidates?.[0]?.content?.parts?.[0]?.text
              || parsed.error?.message || 'No response';
          } else {
            text = parsed.choices?.[0]?.message?.content
              || parsed.error?.message || 'No response';
          }

          resolve({ text, raw: parsed });
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}\nRaw: ${data.slice(0, 500)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
});

// Save/load settings
const Store = (() => {
  const fs = require('fs');
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  return {
    get: () => {
      try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
      catch { return {}; }
    },
    set: (data) => {
      fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
    },
  };
})();

ipcMain.handle('settings-get', () => Store.get());
ipcMain.handle('settings-set', (_, data) => { Store.set(data); return true; });

// Conversation storage
const Conversations = (() => {
  const fs = require('fs');
  const convDir = path.join(app.getPath('userData'), 'conversations');
  if (!fs.existsSync(convDir)) fs.mkdirSync(convDir, { recursive: true });

  return {
    list() {
      return fs.readdirSync(convDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try { return JSON.parse(fs.readFileSync(path.join(convDir, f), 'utf8')); }
          catch { return null; }
        })
        .filter(Boolean)
        .map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt, updatedAt }))
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    },
    load(id) {
      try { return JSON.parse(fs.readFileSync(path.join(convDir, id + '.json'), 'utf8')); }
      catch { return null; }
    },
    save(conv) {
      conv.updatedAt = new Date().toISOString();
      fs.writeFileSync(path.join(convDir, conv.id + '.json'), JSON.stringify(conv, null, 2));
      return true;
    },
    delete(id) {
      const p = path.join(convDir, id + '.json');
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return true;
    },
  };
})();

ipcMain.handle('conv-list', () => Conversations.list());
ipcMain.handle('conv-load', (_, id) => Conversations.load(id));
ipcMain.handle('conv-save', (_, conv) => Conversations.save(conv));
ipcMain.handle('conv-delete', (_, id) => Conversations.delete(id));
