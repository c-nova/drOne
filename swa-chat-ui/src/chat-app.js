import { LitElement, html, css } from 'lit'
import { marked } from 'marked'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

class ChatApp extends LitElement {
  // 履歴用stateはstatic propertiesで管理！
  // 画面ロード時に進行中ジョブだけ復元（履歴機能は削除！）
  connectedCallback() {
    // 履歴も取得して保存するよ！
    (async () => {
      try {
        const res = await fetch('http://localhost:7071/api/research/jobs');
        if (!res.ok) return;
        const data = await res.json();
        if (!data.jobs) return;
        // 履歴（完了・失敗ジョブ）を保存
        this.historyJobs = data.jobs.filter(j => j.status === 'completed' || j.status === 'failed').map(j => ({
          jobId: j.id,
          threadId: j.thread_id || '-',
          summary: (j.result || j.error_message || '').slice(0, 40),
          status: j.status,
          created_at: j.created_at || ''
        }));
        // ...existing code...
      } catch (e) {}
    })();
    if (super.connectedCallback) super.connectedCallback();
    (async () => {
      try {
        const res = await fetch('http://localhost:7071/api/research/jobs');
        if (!res.ok) return;
        const data = await res.json();
        if (!data.jobs) return;
        // 進行中ジョブがあればprogress表示＋ポーリング復元
        const inProgress = data.jobs.find(j => ['created','starting','in_progress','queued','requires_action'].includes(j.status));
        if (inProgress) {
          this.currentProgress = {
            status: inProgress.status,
            message: '🔍 Deep Research実行中...',
            jobId: inProgress.id,
            timestamp: inProgress.start_time || inProgress.created_at
          };
          this.messages = [{
            type: 'progress',
            content: 'Deep Research実行中...',
            progress: this.currentProgress
          }];
          this.pollJobStatus(inProgress.id).then(result => {
            this.messages = this.messages.filter(msg => msg.type !== 'progress');
            if (result.success) {
              this.messages = [...this.messages, {
                type: 'ai',
                content: result.result,
                references: [],
                statusUpdates: result.steps || [],
                jobId: inProgress.id
              }];
            } else {
              const errMsg = result.error_message || result.error || 'Unknown error';
              this.messages = [...this.messages, {
                type: 'ai',
                content: `エラーが発生しました: ${errMsg}`,
                references: [],
                jobId: inProgress.id
              }];
            }
          });
        } else {
          this.messages = [];
        }
      } catch (e) {
        // 何もしない
      }
    })();
  }
  static styles = css`
    :host {
      display: block;
      width: 90vw;
      max-width: 1200px;
      height: 80vh;
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.1);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      text-align: center;
      font-size: 1.5rem;
      font-weight: bold;
    }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      background: #f8f9fa;
    }

    .message {
      margin-bottom: 15px;
      padding: 15px;
      border-radius: 15px;
      max-width: 80%;
      line-height: 1.4;
    }

    .user-message {
      background: #007bff;
      color: white;
      margin-left: auto;
      text-align: right;
    }

    .ai-message {
      background: white;
      color: #333;
      border: 1px solid #e0e0e0;
      margin-right: auto;
    }

    .input-area {
      display: flex;
      padding: 20px;
      background: white;
      border-top: 1px solid #e0e0e0;
    }

    .input-field {
      flex: 1;
      padding: 15px;
      border: 2px solid #e0e0e0;
      border-radius: 25px;
      font-size: 16px;
      outline: none;
      transition: border-color 0.3s;
    }

    .input-field:focus {
      border-color: #667eea;
    }

    .send-button {
      margin-left: 10px;
      padding: 15px 25px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 25px;
      font-size: 16px;
      cursor: pointer;
      transition: transform 0.2s;
    }

    .send-button:hover {
      transform: translateY(-2px);
    }

    .send-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    .loading {
      text-align: center;
      color: #666;
      font-style: italic;
      padding: 20px;
    }

    .references {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #e0e0e0;
      font-size: 0.9rem;
    }

    .reference-link {
      color: #007bff;
      text-decoration: none;
      display: block;
      margin-bottom: 5px;
    }

    .reference-link:hover {
      text-decoration: underline;
    }

    /* マークダウンレンダリング用スタイル */
    .markdown-content {
      line-height: 1.6;
    }

    .markdown-content h1, .markdown-content h2, .markdown-content h3 {
      color: #333;
      margin-top: 20px;
      margin-bottom: 10px;
      font-weight: bold;
    }

    .markdown-content h1 { font-size: 1.8em; }
    .markdown-content h2 { font-size: 1.5em; }
    .markdown-content h3 { font-size: 1.3em; }

    .markdown-content p {
      margin-bottom: 10px;
    }

    .markdown-content ul, .markdown-content ol {
      margin-left: 20px;
      margin-bottom: 10px;
    }

    .markdown-content li {
      margin-bottom: 5px;
    }

    .markdown-content code {
      background: #f5f5f5;
      padding: 2px 4px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
    }

    .markdown-content pre {
      background: #f5f5f5;
      padding: 10px;
      border-radius: 5px;
      overflow-x: auto;
      margin-bottom: 10px;
    }

    .markdown-content strong, .markdown-content b {
      font-weight: bold;
    }

    .markdown-content em, .markdown-content i {
      font-style: italic;
    }

    /* メッセージアクション用スタイル */
    .message-actions {
      margin-top: 10px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .action-btn {
      background: #f0f0f0;
      border: 1px solid #ddd;
      border-radius: 15px;
      padding: 5px 12px;
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .action-btn:hover {
      background: #e0e0e0;
      transform: translateY(-1px);
    }

    .action-btn:active {
      transform: translateY(0);
    }

    .action-btn.success {
      background: #d4edda;
      border-color: #c3e6cb;
      color: #155724;
    }

    .progress-message {
      background: #e3f2fd;
      border: 1px solid #bbdefb;
      color: #1565c0;
      font-style: italic;
    }

    .progress-indicator {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }

    .progress-spinner {
      width: 20px;
      height: 20px;
      border: 2px solid #f3f3f3;
      border-top: 2px solid #1565c0;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    .status-updates {
      background: #f8f9fa;
      border: 1px solid #dee2e6;
      border-radius: 8px;
      padding: 10px;
      margin-top: 10px;
      font-size: 0.9rem;
    }

    .status-update {
      padding: 5px 0;
      border-bottom: 1px solid #eee;
    }

    .status-update:last-child {
      border-bottom: none;
    }

    .status-timestamp {
      color: #6c757d;
      font-size: 0.8rem;
    }

    /* スクロールバーのスタイル */
    ::slotted(.messages) {
      scrollbar-width: thin;
      scrollbar-color: #667eea #f1f1f1;
    }

    ::slotted(.messages::-webkit-scrollbar) {
      width: 8px;
    }

    ::slotted(.messages::-webkit-scrollbar-track) {
      background: #f1f1f1;
    }

    ::slotted(.messages::-webkit-scrollbar-thumb) {
      background-color: #667eea;
      border-radius: 10px;
    }

    ::slotted(.messages::-webkit-scrollbar-thumb:hover) {
      background-color: #0056b3;
    }
  `


  static properties = {
    messages: { type: Array },
    loading: { type: Boolean },
    inputValue: { type: String },
    isComposing: { type: Boolean },
    currentProgress: { type: Object },
    historyJobs: { type: Array }
  }

  // 画面ロード時にサーバーからジョブ履歴・進行中ジョブを復元
  connectedCallback() {
    if (super.connectedCallback) super.connectedCallback();
    // 非同期処理は即時関数で
    (async () => {
      try {
        const res = await fetch('http://localhost:7071/api/research/jobs');
        if (!res.ok) return;
        const data = await res.json();
        if (!data.jobs) return;
        // デバッグ用: APIレスポンスを確認
        console.log('履歴API jobs:', data.jobs);

        // 履歴（完了・失敗ジョブ）をhistoryJobsに保存！
        this.historyJobs = data.jobs.filter(j => j.status === 'completed' || j.status === 'failed').map(j => ({
          jobId: j.id,
          threadId: j.thread_id || '-',
          summary: (j.result || j.error_message || '').slice(0, 40),
          status: j.status,
          created_at: j.created_at || ''
        }));

        // 2. 過去の履歴をmessagesに追加
        const historyMsgs = data.jobs.filter(j => j.status === 'completed' || j.status === 'failed').map(j => {
          if (j.status === 'completed') {
            return {
              type: 'ai',
              content: j.result || '（結果データはAPIから再取得可）',
              jobId: j.id
            };
          } else {
            return {
              type: 'ai',
              content: `エラーが発生しました: ${j.error_message || 'Unknown error'}`,
              jobId: j.id
            };
          }
        });

        // 3. 進行中ジョブがあればprogress表示＋ポーリング復元
        const inProgress = data.jobs.find(j => ['created','starting','in_progress','queued','requires_action'].includes(j.status));
        if (inProgress) {
          // progressメッセージ追加
          this.currentProgress = {
            status: inProgress.status,
            message: '🔍 Deep Research実行中...',
            jobId: inProgress.id,
            timestamp: inProgress.start_time || inProgress.created_at
          };
          this.messages = [...historyMsgs, {
            type: 'progress',
            content: 'Deep Research実行中...',
            progress: this.currentProgress
          }];
          // ポーリング再開
          this.pollJobStatus(inProgress.id).then(result => {
            this.messages = this.messages.filter(msg => msg.type !== 'progress');
            if (result.success) {
              this.messages = [...this.messages, {
                type: 'ai',
                content: result.result,
                references: [],
                statusUpdates: result.steps || [],
                jobId: inProgress.id
              }];
            } else {
              const errMsg = result.error_message || result.error || 'Unknown error';
              this.messages = [...this.messages, {
                type: 'ai',
                content: `エラーが発生しました: ${errMsg}`,
                references: [],
                jobId: inProgress.id
              }];
            }
          });
        } else {
          this.messages = [];
        }
      } catch (e) {
        // 何もしない
      }
    })();
  }

  constructor() {
    super();
    this.messages = [];
    this.loading = false;
    this.inputValue = '';
    this.isComposing = false;
    this.currentProgress = null;
    this.historyJobs = [];
  }

  render() {
    // 履歴サイドバー付きUIだけを1回だけreturn！
    const historyJobs = Array.isArray(this.historyJobs) ? this.historyJobs : [];
    return html`
      <div style="display:flex; height:100%;">
        <aside style="width:240px;min-width:160px;max-width:320px;background:#f3f3fa;border-right:1px solid #eee;padding:16px 8px 16px 16px;box-sizing:border-box;overflow-y:auto;">
          <h2 style="margin-top:0;margin-bottom:14px;font-size:1.08em;color:#764ba2;display:flex;align-items:center;justify-content:space-between;">
            <span>🗂 履歴</span>
          </h2>
          ${historyJobs.length === 0 ? html`<div style="color:#888">履歴なし</div>` : html`
            <ul style="list-style:none;padding:0;margin:0;">
              ${historyJobs.map(job => html`
                <li style="margin-bottom:10px;">
                  <div style="cursor:pointer;padding:8px;border-radius:6px;border-left:4px solid ${job.status==='completed'?'#28a745':job.status==='failed'?'#dc3545':'#ffc107'};background:#fff;"
                    @click=${() => this._selectHistoryJob(job.jobId)}
                  >
                    <div style="font-size:13px;color:#888;">${job.created_at}</div>
                    <div style="font-weight:bold;white-space:normal;word-break:break-all;">${job.summary}</div>
                    <div style="font-size:12px;color:#555;">Status: <span style="font-weight:bold;">${job.status}</span></div>
                    <div style="font-size:12px;color:#aaa;">Job ID: ${job.jobId}</div>
                    <div style="font-size:12px;color:#aaa;">Thread ID: ${job.threadId}</div>
                  </div>
                </li>
              `)}
            </ul>
          `}
        </aside>
        <div style="flex:1;display:flex;flex-direction:column;min-width:0;">
          <div class="header">
            🔍 Deep Research Chat
          </div>
          <div class="messages" id="messages" style="flex:1;overflow-y:auto;">
            ${this.messages.map(msg => this._renderMessage(msg))}
          </div>
          <div class="input-area">
            <input 
              type="text" 
              class="input-field" 
              placeholder="質問を入力してください..."
              .value=${this.inputValue}
              @input=${this._handleInput}
              @keydown=${this._handleKeyDown}
              @compositionstart=${this._handleCompositionStart}
              @compositionend=${this._handleCompositionEnd}
              ?disabled=${this.loading}
            >
            <button 
              class="send-button" 
              @click=${this._sendMessage}
              ?disabled=${this.loading || !this.inputValue.trim()}
            >
              送信
            </button>
          </div>
        </div>
      </div>
    `;
  }
  // チャット内容クリア（新規開始）
  _clearChat() {
    this.messages = [];
    this.inputValue = '';
    this.currentProgress = null;
    this.loading = false;
    this.requestUpdate();
  }
  // 履歴クリック時にそのJobの詳細だけ表示
  _selectHistoryJob(jobId) {
    // ギャル流！履歴クリックでFoundry APIからメッセージ一覧取得して表示！
    (async () => {
      try {
        this.loading = true;
        this.messages = [];
        // 履歴からthreadIdを探す
        const job = this.historyJobs.find(j => j.jobId === jobId);
        const threadId = job?.threadId;
        if (!threadId || threadId === '-') throw new Error('Thread IDが見つからないよ！');

        // Foundry APIエンドポイントとトークン（仮）
        const endpoint = window.AZURE_AI_FOUNDRY_PROJECT_ENDPOINT || 'https://your-foundry-endpoint';
        const token = window.AGENT_TOKEN || 'your-token';

        // メッセージ一覧取得
        const resp = await fetch(`http://localhost:7071/api/research/status/${jobId}`);
        if (!resp.ok) throw new Error('メッセージ取得失敗: ' + resp.status);
        const data = await resp.json();
        // messages配列がなければエラー
        if (!Array.isArray(data.messages)) throw new Error('messages配列が見つからないよ！');

        // test_api.htmlのCheckStatus表示ロジックを参考に、content配列を全部表示！
        // 中間メッセージも含めて全部出す！
        // 表示順序を古い順（下）→新しい順（上）にするため、messagesを逆順でセット！
        const msgList = [];
        data.messages.forEach(msg => {
          let content = '';
          let references = [];
          // contentは配列で来ることが多い
          if (Array.isArray(msg.content)) {
            content = msg.content.map(c => typeof c === 'string' ? c : JSON.stringify(c)).join('\n');
          } else if (typeof msg.content === 'string') {
            content = msg.content;
          } else if (msg.content && typeof msg.content === 'object') {
            if (typeof msg.content.text === 'string') {
              content = msg.content.text;
            } else if (Array.isArray(msg.content.parts)) {
              content = msg.content.parts.map(p => p.text).join('\n');
            } else {
              content = JSON.stringify(msg.content);
            }
          }
          // citations, references, urls, sourcesも全部referencesにまとめる
          if (Array.isArray(msg.citations)) {
            msg.citations.forEach(cite => {
              references.push({ url: cite.url, title: cite.title || cite.url });
            });
          }
          if (Array.isArray(msg.references)) {
            msg.references.forEach(ref => {
              references.push({ url: ref.url || ref, title: ref.title || ref.url || ref });
            });
          }
          if (Array.isArray(msg.urls)) {
            msg.urls.forEach(url => {
              references.push({ url: url, title: url });
            });
          }
          if (Array.isArray(msg.sources)) {
            msg.sources.forEach(src => {
              references.push({ url: src, title: src });
            });
          }
          // roleでuser/ai分岐
          let type = 'ai';
          if (msg.role === 'user') type = 'user';
          msgList.push({
            type,
            content,
            references,
            jobId: jobId,
            messageId: msg.id,
            timestamp: msg.created_at || ''
          });
        });
        this.messages = msgList.reverse();
      } catch (e) {
        this.messages = [{
          type: 'ai',
          content: `履歴取得でエラー: ${e.message}`,
          jobId: jobId
        }];
      } finally {
        this.loading = false;
        this.currentProgress = null;
        this.inputValue = '';
        this.requestUpdate();
        // メッセージ領域を最下部にスクロール
        this.updateComplete.then(() => {
          const messagesEl = this.shadowRoot.getElementById('messages');
          if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
        });
      }
    })();
  }

  // メッセージごとの描画を分岐で返す
  _renderMessage(msg) {
    if (msg.type === 'progress') {
      return html`
        <div class="message progress-message">
          <div class="message-content">
            <div class="progress-indicator">
              <div class="progress-spinner"></div>
              <span>${msg.progress?.message || 'Processing...'}</span>
            </div>
            <div class="status-timestamp">開始時刻: ${msg.progress?.timestamp}</div>
            ${msg.progress?.timestamp ? html`
              <div class="status-timestamp">
                実行時間: ${this._formatDuration(
                  msg.progress.timestamp,
                  msg.progress?.step === 'completed' && msg.progress?.endTime
                    ? msg.progress.endTime
                    : new Date().toISOString()
                )}
              </div>
            ` : ''}
          </div>
        </div>
      `;
    } else if (msg.type === 'ai') {
      return html`
        <div class="message ai-message">
          <div class="message-content">
            <div class="markdown-content" .innerHTML="${this._renderMarkdown(msg.content)}"></div>
          </div>
          ${msg.statusUpdates && msg.statusUpdates.length > 0 ? html`
            <div class="status-updates">
              <strong>🔄 プロセス履歴:</strong>
              ${msg.statusUpdates.map(update => html`
                <div class="status-update">
                  <div>${update.message}</div>
                  <div class="status-timestamp">
                    ${new Date(update.timestamp * 1000).toLocaleTimeString()}
                  </div>
                </div>
              `)}
            </div>
          ` : ''}
          <div class="message-actions">
            <button @click="${() => this._downloadAsPDF(msg.content)}" class="action-btn">
              📄 PDF
            </button>
            <button @click="${() => this._downloadAsMarkdown(msg.content)}" class="action-btn">
              📝 MD
            </button>
            <button @click="${() => this._copyToClipboard(msg.content)}" class="action-btn">
              📋 Copy
            </button>
          </div>
          ${msg.references && msg.references.length > 0 ? html`
            <div class="references">
              <strong>参考URL:</strong>
              ${msg.references.map(ref => html`
                <a href="${ref.url}" class="reference-link" target="_blank">
                  ${ref.title || ref.url}
                </a>
              `)}
            </div>
          ` : ''}
        </div>
      `;
    } else if (msg.type === 'user') {
      return html`
        <div class="message user-message">
          <div class="message-content">
            <div>${msg.content}</div>
          </div>
        </div>
      `;
    }
    return html``;
  }

  // 開始・終了時刻から実行時間を計算して表示
  _formatDuration(start, end) {
    try {
      // Z無しはローカル、Z付きはUTCとしてパース
      let startTime;
      if (typeof start === 'string') {
        if (/Z$/.test(start)) {
          startTime = new Date(start);
        } else {
          // YYYY-MM-DD HH:mm:ss 形式などはローカルタイムとして扱う
          startTime = new Date(start.replace(/-/g, '/'));
        }
      } else {
        startTime = start;
      }
      let endTime;
      if (typeof end === 'string') {
        if (/Z$/.test(end)) {
          endTime = new Date(end);
        } else {
          endTime = new Date(end.replace(/-/g, '/'));
        }
      } else {
        endTime = end;
      }
      const diff = Math.max(0, endTime.getTime() - startTime.getTime());
      const sec = Math.floor(diff / 1000) % 60;
      const min = Math.floor(diff / 60000) % 60;
      const hr = Math.floor(diff / 3600000);
      let result = '';
      if (hr > 0) result += hr + '時間';
      if (min > 0) result += min + '分';
      result += sec + '秒';
      return result;
    } catch (e) {
      return '';
    }
  }

  _handleInput(e) {
    this.inputValue = e.target.value
  }

  _handleCompositionStart(e) {
    this.isComposing = true
  }

  _handleCompositionEnd(e) {
    this.isComposing = false
  }

  _handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !this.isComposing) {
      e.preventDefault()
      this._sendMessage()
    }
  }

  async _sendMessage() {
    const query = this.inputValue.trim()
    if (!query || this.loading) return

    // ユーザーメッセージを追加
    this.messages = [...this.messages, { 
      type: 'user', 
      content: query 
    }]
    
    this.inputValue = ''
    this.loading = true
    
    // プログレス情報をリセットして初期状態を設定
    const now = new Date();
    this.currentProgress = {
      status: 'starting',
      message: '🚀 Deep Research を開始しています...',
      timestamp: now.toLocaleTimeString(),
      start_time: now.toISOString()
    }
    
    // プログレス表示用の一時メッセージを追加
    this.messages = [...this.messages, {
      type: 'progress',
      content: 'Deep Research開始中...',
      progress: this.currentProgress
    }]
    
    // メッセージ領域を最下部にスクロール
    this.updateComplete.then(() => {
      const messagesEl = this.shadowRoot.getElementById('messages')
      messagesEl.scrollTop = messagesEl.scrollHeight
    })

    try {
      // 1. Deep Research開始
      const startResponse = await fetch('http://localhost:7071/api/research/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, user_id: 'anonymous' })
      })

      if (!startResponse.ok) {
        throw new Error(`HTTP error! status: ${startResponse.status}`)
      }

      const startData = await startResponse.json()
      const jobId = startData.job_id
      
      // プログレス表示を更新
      // CheckStatus APIから開始時刻(created_at)を取得
      let start_time = this.currentProgress.start_time;
      try {
        const statusResp = await fetch(`http://localhost:7071/api/research/status/${jobId}`);
        if (statusResp.ok) {
          const statusData = await statusResp.json();
          if (statusData.created_at) {
            start_time = statusData.created_at;
          }
        }
      } catch (e) { /* 無視 */ }

      this.currentProgress = {
        ...this.currentProgress,
        message: '🔍 Deep Research実行中...',
        step: 'researching',
        jobId: jobId,
        timestamp: start_time || this.currentProgress.timestamp
      }

      this.messages = this.messages.map(msg => 
        msg.type === 'progress' ? 
        { ...msg, content: 'Deep Research実行中...', progress: this.currentProgress } : 
        msg
      )
      
      // 2. ポーリングで状態確認
      const pollResult = await this.pollJobStatus(jobId)

      // プログレス表示を削除してAIメッセージを追加
      this.messages = this.messages.filter(msg => msg.type !== 'progress')

      if (pollResult.success) {
        this.messages = [...this.messages, {
          type: 'ai',
          content: pollResult.result,
          references: [],
          statusUpdates: pollResult.steps || [],
          jobId: jobId
        }]
      } else {
        // error_messageやerrorがあれば優先して表示
        const errMsg = pollResult.error_message || pollResult.error || 'Unknown error';
        this.messages = [...this.messages, {
          type: 'ai',
          content: `エラーが発生しました: ${errMsg}`,
          references: [],
          jobId: jobId
        }]
      }

      // 履歴機能削除！
      
    } catch (error) {
      console.error('API error:', error)
      
      // プログレス表示を削除
      this.messages = this.messages.filter(msg => msg.type !== 'progress')
      
      this.messages = [...this.messages, {
        type: 'ai',
        content: `エラーが発生しました: ${error.message}`,
        references: []
      }]
    } finally {
      this.loading = false
      this.currentProgress = null
      
      // メッセージ領域を最下部にスクロール
      this.updateComplete.then(() => {
        const messagesEl = this.shadowRoot.getElementById('messages')
        messagesEl.scrollTop = messagesEl.scrollHeight
      })
    }
  }

  async pollJobStatus(jobId, maxAttempts = 360) { // 最大1時間（10秒間隔）
    let lastStepCount = 0;
    let lastSteps = [];
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const statusResponse = await fetch(`http://localhost:7071/api/research/status/${jobId}`)
        if (!statusResponse.ok) {
          throw new Error(`Status check failed: ${statusResponse.status}`)
        }
        const statusData = await statusResponse.json()

        // 進捗stepsがあれば都度表示！
        const steps = Array.isArray(statusData.steps) ? statusData.steps : [];
        if (steps.length > lastStepCount) {
          const newSteps = steps.slice(lastStepCount);
          newSteps.forEach(step => {
            let ts = undefined;
            if (typeof step.timestamp === 'number' && !isNaN(step.timestamp)) {
              try {
                ts = new Date(step.timestamp * 1000).toISOString();
              } catch (e) {
                ts = undefined;
              }
            }
            this.messages = [
              ...this.messages,
              {
                type: 'progress',
                content: step.message || step.status || '進捗更新',
                progress: {
                  ...this.currentProgress,
                  message: step.message || step.status,
                  timestamp: ts,
                  step: step.status || undefined
                }
              }
            ];
            this.requestUpdate();
            this.updateComplete.then(() => {
              const messagesEl = this.shadowRoot.getElementById('messages');
              if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
            });
          });
          lastStepCount = steps.length;
          lastSteps = steps;
        }

      if (Array.isArray(statusData.messages)) {
        // 最新Threadのみ表示！他jobIdのメッセージは除外
        this.messages = this.messages.filter(msg => msg.jobId === jobId || !msg.jobId || msg.type === 'progress');
        statusData.messages.forEach(msg => {
          if (msg.id && shownMessageIds.has(msg.id)) return; // 既に表示済みはスキップ
          let content = '';
          let references = [];
          // content抽出ロジック（履歴と同じ！）
          if (Array.isArray(msg.content)) {
            content = msg.content.map(c => typeof c === 'string' ? c : JSON.stringify(c)).join('\n');
          } else if (typeof msg.content === 'string') {
            content = msg.content;
          } else if (msg.content && typeof msg.content === 'object') {
            if (typeof msg.content.text === 'string') {
              content = msg.content.text;
            } else if (Array.isArray(msg.content.parts)) {
              content = msg.content.parts.map(p => p.text).join('\n');
            } else {
              content = JSON.stringify(msg.content);
            }
          }
          // citations, references, urls, sourcesも全部referencesにまとめる
          if (Array.isArray(msg.citations)) {
            msg.citations.forEach(cite => {
              references.push({ url: cite.url, title: cite.title || cite.url });
            });
          }
          if (Array.isArray(msg.references)) {
            msg.references.forEach(ref => {
              references.push({ url: ref.url || ref, title: ref.title || ref.url || ref });
            });
          }
          if (Array.isArray(msg.urls)) {
            msg.urls.forEach(url => {
              references.push({ url: url, title: url });
            });
          }
          if (Array.isArray(msg.sources)) {
            msg.sources.forEach(src => {
              references.push({ url: src, title: src });
            });
          }
          let type = 'ai';
          if (msg.role === 'user') type = 'user';
          this.messages = [
            ...this.messages,
            {
              type,
              content,
              references,
              jobId: jobId,
              messageId: msg.id,
              timestamp: msg.created_at || ''
            }
          ];
          if (msg.id) shownMessageIds.add(msg.id);
          this.requestUpdate();
          this.updateComplete.then(() => {
            const messagesEl = this.shadowRoot.getElementById('messages');
            if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
          });
        });
      }

        // プログレス表示も更新（current_stepがあれば）
        if (this.currentProgress && statusData.current_step) {
          let start_time = statusData.created_at || this.currentProgress.timestamp;
          let end_time = statusData.completed_at || (statusData.status === 'completed' ? new Date().toISOString() : undefined);
          this.currentProgress = {
            ...this.currentProgress,
            message: `🔍 ${statusData.current_step}`,
            step: statusData.status,
            timestamp: start_time,
            endTime: end_time,
            thread_id: statusData.thread_id,
            run_id: statusData.run_id
          }
          this.messages = this.messages.map(msg => 
            msg.type === 'progress' ? 
            { ...msg, content: `${statusData.current_step}\n[Thread ID: ${statusData.thread_id || '-'} / Run ID: ${statusData.run_id || '-'}]`, progress: this.currentProgress } : 
            msg
          )
          this.requestUpdate()
        }

        if (statusData.status === 'completed') {
          const resultResponse = await fetch(`http://localhost:7071/api/research/result/${jobId}`)
          const resultData = await resultResponse.json()
          return {
            success: true,
            result: resultData.result + `\n\n[Thread ID: ${statusData.thread_id || '-'} / Run ID: ${statusData.run_id || '-'}]`,
            steps: resultData.steps,
            messages: statusData.messages || []
          }
        } else if (statusData.status === 'failed') {
          return {
            success: false,
            error: (statusData.error_message || statusData.error || '調査に失敗しました') + `\n[Thread ID: ${statusData.thread_id || '-'} / Run ID: ${statusData.run_id || '-'}]`,
            messages: statusData.messages || []
          }
        }

        await new Promise(resolve => setTimeout(resolve, 10000))

      } catch (error) {
        console.error(`Status polling attempt ${attempt + 1} failed:`, error)
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, 10000))
          continue
        }
        return {
          success: false,
          error: `ポーリングエラー: ${error.message}`
        }
      }
    }
    return {
      success: false,
      error: 'タイムアウト: 調査に時間がかかりすぎています'
    }
  }

  // マークダウンレンダリング
  _renderMarkdown(content) {
    try {
      // markedの設定
      marked.setOptions({
        breaks: true,
        gfm: true
      })
      return marked(content)
    } catch (error) {
      console.error('Markdown parsing error:', error)
      return content.replace(/\n/g, '<br>')
    }
  }

  // PDFダウンロード
  async _downloadAsPDF(content) {
    try {
      // 一時的な要素を作成してマークダウンをレンダリング
      const tempDiv = document.createElement('div')
      tempDiv.innerHTML = this._renderMarkdown(content)
      tempDiv.style.cssText = `
        position: absolute;
        left: -9999px;
        width: 800px;
        padding: 20px;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        line-height: 1.6;
        color: #333;
      `
      document.body.appendChild(tempDiv)

      // html2canvasでキャンバスに変換
      const canvas = await html2canvas(tempDiv, {
        scale: 1,
        useCORS: true,
        allowTaint: true
      })

      // PDFを作成
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF('p', 'mm', 'a4')
      
      const imgWidth = 190 // A4幅 - マージン
      const pageHeight = 297 // A4高さ
      const imgHeight = (canvas.height * imgWidth) / canvas.width
      let heightLeft = imgHeight
      let position = 10

      // 最初のページ
      pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight)
      heightLeft -= pageHeight

      // 複数ページ対応
      while (heightLeft >= 0) {
        position = heightLeft - imgHeight + 10
        pdf.addPage()
        pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight)
        heightLeft -= pageHeight
      }

      // ダウンロード
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
      pdf.save(`deep-research-report-${timestamp}.pdf`)

      // 一時要素を削除
      document.body.removeChild(tempDiv)
    } catch (error) {
      console.error('PDF download error:', error)
      alert('PDFの生成に失敗しました: ' + error.message)
    }
  }

  // マークダウンダウンロード
  _downloadAsMarkdown(content) {
    try {
      const blob = new Blob([content], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
      a.download = `deep-research-report-${timestamp}.md`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Markdown download error:', error)
      alert('マークダウンのダウンロードに失敗しました: ' + error.message)
    }
  }

  // クリップボードにコピー
  async _copyToClipboard(content) {
    try {
      await navigator.clipboard.writeText(content)
      // 一時的な成功表示 - イベントを正しく取得
      const buttons = this.shadowRoot.querySelectorAll('.action-btn')
      const copyBtn = Array.from(buttons).find(btn => btn.textContent.includes('Copy'))
      if (copyBtn) {
        const originalText = copyBtn.textContent
        copyBtn.textContent = '✅ Copied!'
        setTimeout(() => {
          copyBtn.textContent = originalText
        }, 2000)
      }
    } catch (error) {
      console.error('Clipboard copy error:', error)
      alert('クリップボードへのコピーに失敗しました: ' + error.message)
    }
  }
}

customElements.define('chat-app', ChatApp)
