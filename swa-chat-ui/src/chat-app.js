import { LitElement, html, css } from 'lit'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType } from 'docx'
import { Buffer } from 'buffer'
import { MarkdownRenderer } from './markdown-renderer.js'
import { FileExporter } from './file-exporter.js'
import { MessageRenderer } from './message-renderer.js'
import { MessageProcessor } from './message-processor.js'

// グローバルBufferを設定
window.Buffer = Buffer

class ChatApp extends LitElement {
  // 履歴用stateはstatic propertiesで管理！
  // 画面ロード時に進行中ジョブだけ復元（履歴機能は削除！）
  connectedCallback() {
    console.log('connectedCallback 開始！');
    super.connectedCallback();
    
    // 履歴取得をリトライ付きで実行
    this.loadHistoryWithRetry();
  }
  
  firstUpdated() {
    console.log('firstUpdated 開始！');
    // connectedCallbackが実行されなかった場合のフォールバック
    if (!this.historyJobs || this.historyJobs.length === 0) {
      console.log('履歴が空なので、再度履歴を取得します...');
      this.loadHistoryWithRetry();
    }
    
    // アクションボタンのイベントハンドラーを設定
    this.setupActionButtonHandlers();
  }
  
  async loadHistoryWithRetry(retries = 3) {
    console.log('履歴取得開始！リトライ回数:', retries);
    try {
      const res = await fetch('http://localhost:7071/api/research/jobs');
      console.log('API response:', res.status, res.statusText);
      if (!res.ok) {
        throw new Error(`API呼び出しエラー: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      console.log('取得したデータ:', data);
      if (!data.jobs) {
        throw new Error('jobs配列がない');
      }
      
      // 履歴（完了・失敗ジョブ）を保存
      this.historyJobs = data.jobs.filter(j => j.status === 'completed' || j.status === 'failed').map(j => ({
        jobId: j.id,
        threadId: j.thread_id || '-',
        summary: j.query || (j.result || j.error_message || '').slice(0, 40),
        status: j.status,
        created_at: j.created_at || ''
      }));
      console.log('履歴設定完了:', this.historyJobs.length, '件');
      this.requestUpdate(); // 履歴を更新後に再描画を要求
      
      // 進行中ジョブがあればprogress表示＋ポーリング復元
      const inProgress = data.jobs.find(j => ['created','starting','in_progress','queued','requires_action'].includes(j.status));
      if (inProgress) {
        // ブラウザから参照できるようにグローバルに設定
        window.currentJobId = inProgress.id;
        console.log('[DEBUG] Found in-progress job, set currentJobId:', inProgress.id);
        
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
              content: `❌ エラーが発生しました: ${errMsg}`,
              references: [],
              statusUpdates: [],
              jobId: inProgress.id
            }];
          }
          this.currentProgress = null;
          this.requestUpdate();
        });
        this.requestUpdate();
      }
      
    } catch (e) {
      console.error('履歴取得エラー:', e);
      if (retries > 0) {
        console.log(`${retries}回リトライします...`);
        setTimeout(() => this.loadHistoryWithRetry(retries - 1), 2000);
      } else {
        console.error('履歴取得に失敗しました。すべてのリトライを使い切りました。');
      }
    }
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

    /* PDF/印刷用スタイル */
    @media print {
      .message {
        page-break-inside: avoid;
        break-inside: avoid;
        margin-bottom: 15px;
        padding: 15px;
        border: 1px solid #ccc;
      }

      .ai-message {
        page-break-inside: avoid;
        break-inside: avoid;
        orphans: 3;
        widows: 3;
      }

      .markdown-content h1, .markdown-content h2, .markdown-content h3 {
        page-break-after: avoid;
        break-after: avoid;
        page-break-inside: avoid;
        break-inside: avoid;
      }

      .markdown-content p {
        orphans: 3;
        widows: 3;
        page-break-inside: avoid;
        break-inside: avoid;
      }

      .markdown-content ul, .markdown-content ol {
        page-break-inside: avoid;
        break-inside: avoid;
      }

      .markdown-content li {
        page-break-inside: avoid;
        break-inside: avoid;
      }

      .markdown-content blockquote {
        page-break-inside: avoid;
        break-inside: avoid;
        border-left: 4px solid #ccc;
        padding-left: 10px;
        margin: 10px 0;
      }

      .markdown-content table {
        page-break-inside: avoid;
        break-inside: avoid;
        margin: 10px 0;
      }

      .citation-link {
        page-break-inside: avoid;
        break-inside: avoid;
      }

      /* ページ余白の調整 */
      @page {
        margin: 4cm 2.5cm;  /* 上下4cm、左右2.5cm（大きめの余白） */
        size: A4 portrait;
        padding: 0;
      }

      /* より強力な印刷制御 */
      .message {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        margin-bottom: 2cm !important;  /* メッセージ間を大きく空ける */
        padding: 15px !important;
        border: 1px solid #ccc !important;
        overflow: visible !important;
        display: block !important;  /* flexboxを無効化 */
        min-height: 3cm !important;  /* 最小高さを確保 */
      }

      .ai-message {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        orphans: 4 !important;  /* 段落の最初で最低4行確保 */
        widows: 4 !important;   /* 段落の最後で最低4行確保 */
        margin-bottom: 1.5cm !important;
      }

      .markdown-content h1, .markdown-content h2, .markdown-content h3 {
        page-break-after: avoid !important;
        break-after: avoid !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        margin-top: 1.5cm !important;
        margin-bottom: 1cm !important;
      }

      .markdown-content p {
        orphans: 4 !important;
        widows: 4 !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        margin-bottom: 0.8cm !important;
        line-height: 1.8 !important;  /* 行間を広く */
      }

      .markdown-content ul, .markdown-content ol {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        margin-bottom: 1cm !important;
      }

      .markdown-content li {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        margin-bottom: 0.3cm !important;
      }

      .markdown-content blockquote {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        border-left: 4px solid #ccc !important;
        padding-left: 10px !important;
        margin: 1cm 0 !important;
      }

      .markdown-content table {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        margin: 1cm 0 !important;
      }

      .citation-link {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }

      /* 不要な要素を非表示 */
      .input-area,
      .message-actions,
      .action-btn {
        display: none !important;
      }
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
    
    // グローバルアクセス用の参照を設定
    window.chatApp = this;
    
    // 非同期処理は即時関数で
    (async () => {
      try {
        const res = await fetch('http://localhost:7071/api/research/jobs');
        if (!res.ok) return;
        const data = await res.json();
        if (!data.jobs) return;
        // デバッグ用のannotation情報ログ
        const messages = data.messages || [];
        let allAnnotations = [];
        
        messages.forEach(msg => {
            const citations = msg.citations || [];
            if (citations.length > 0) {
                console.log('[DEBUG] pollJobStatus - Found citations in message:', citations);
                allAnnotations = allAnnotations.concat(citations);
            }
        });
        
        if (allAnnotations.length > 0) {
            console.log('[DEBUG] pollJobStatus - Total annotations found:', allAnnotations);
        } else {
            console.log('[DEBUG] pollJobStatus - No annotations found in messages');
        }        // 2. 過去の履歴をmessagesに追加
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
    
    // グローバルに参照を設定（MessageRendererからアクセスするため）
    window.chatApp = this;
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
                    <div style="font-weight:bold;white-space:normal;word-break:break-all;">
                      ${job.status === 'failed' ? '❌ ' : job.status === 'completed' ? '✅ ' : '🔄 '}${job.summary}
                    </div>
                    <div style="font-size:12px;color:#555;">Status: <span style="font-weight:bold;color:${job.status==='completed'?'#28a745':job.status==='failed'?'#dc3545':'#ffc107'};">${job.status}</span></div>
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
    this._loadJobMessages(jobId);
  }

  // ジョブメッセージの共通読み込み処理
  async _loadJobMessages(jobId) {
    try {
      this.loading = true;
      this.messages = [];
      
      // 履歴からthreadIdを探す
      const job = this.historyJobs.find(j => j.jobId === jobId);
      const threadId = job?.threadId;
      if (!threadId || threadId === '-') {
        throw new Error('Thread IDが見つからないよ！');
      }

      // メッセージ一覧取得
      const resp = await fetch(`http://localhost:7071/api/research/status/${jobId}`);
      if (!resp.ok) {
        throw new Error('メッセージ取得失敗: ' + resp.status);
      }
      
      const data = await resp.json();
      const msgList = [];

      // 失敗ジョブの場合は、エラー情報を最初に表示
      if (data.status === 'failed' && data.error_message) {
        msgList.push(MessageProcessor.createErrorMessage(data, jobId));
      }
      
      // メッセージを処理して追加
      const processedMessages = MessageProcessor.processMessages(data.messages, jobId);
      msgList.push(...processedMessages);
      
      // 失敗ジョブの場合は、stepsも表示
      if (data.status === 'failed') {
        const stepsMessage = MessageProcessor.createStepsMessage(data, jobId);
        if (stepsMessage) {
          msgList.push(stepsMessage);
        }
      }
      
      this.messages = msgList.reverse();
      
    } catch (e) {
      this.messages = [{
        type: 'ai',
        content: `履歴取得でエラー: ${e.message}`,
        jobId: jobId
      }];
    } finally {
      this._finishLoading();
    }
  }

  // 読み込み完了時の共通処理
  _finishLoading() {
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

  // メッセージごとの描画を分岐で返す
  _renderMessage(msg) {
    return MessageRenderer.renderMessage(msg, MessageRenderer.formatDuration);
  }

  // アクションボタンのイベントハンドラーを設定
  setupActionButtonHandlers() {
    // テンプレートで@clickイベントを使うので、ここでは何もしない
    console.log('[DEBUG] setupActionButtonHandlers called - using template @click events');
  }

  // アクションボタンのクリックハンドラー
  handleActionButtonClick(event) {
    console.log('[DEBUG] handleActionButtonClick called:', event);
    console.log('[DEBUG] event.target:', event.target);
    console.log('[DEBUG] event.target.tagName:', event.target.tagName);
    console.log('[DEBUG] event.target.className:', event.target.className);
    
    // Shadow DOM内での要素検索
    const button = event.target.closest('.action-btn');
    console.log('[DEBUG] Button found:', button);
    
    // ボタンが見つからない場合は、イベントターゲット自体がボタンかチェック
    const actualButton = button || (event.target.classList.contains('action-btn') ? event.target : null);
    console.log('[DEBUG] Actual button:', actualButton);
    
    if (!actualButton) {
      console.log('[DEBUG] No button found, returning...');
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const content = actualButton.dataset.content;
    console.log('[DEBUG] Content:', content);
    
    // print-preview-btnの場合はcontentチェックをスキップ
    if (!content && !actualButton.classList.contains('print-preview-btn')) {
      console.log('[DEBUG] No content found, returning...');
      return;
    }

    console.log('[DEBUG] Button classes:', actualButton.className);
    
    if (actualButton.classList.contains('pdf-btn')) {
      console.log('[DEBUG] Calling downloadAsPDF...');
      FileExporter.downloadAsPDF(content);
    } else if (actualButton.classList.contains('print-preview-btn')) {
      console.log('[DEBUG] Opening print preview...');
      this._openPrintPreview();
    } else if (actualButton.classList.contains('word-btn')) {
      console.log('[DEBUG] Calling downloadAsWord...');
      const references = actualButton.dataset.references ? JSON.parse(actualButton.dataset.references) : [];
      FileExporter.downloadAsWord(content, references);
    } else if (actualButton.classList.contains('md-btn')) {
      console.log('[DEBUG] Calling downloadAsMarkdown...');
      FileExporter.downloadAsMarkdown(content);
    } else if (actualButton.classList.contains('copy-btn')) {
      console.log('[DEBUG] Calling copyToClipboard...');
      FileExporter.copyToClipboard(content, this.shadowRoot);
    }
  }

  _openPrintPreview() {
    try {
      // AIメッセージのみを抽出
      const aiMessages = this.messages.filter(msg => msg.type === 'ai' && msg.content);
      
      if (aiMessages.length === 0) {
        alert('印刷可能なAI回答が見つかりません。');
        return;
      }

      // メッセージデータをlocalStorageに保存
      localStorage.setItem('printMessages', JSON.stringify(aiMessages));
      
      // 印刷専用ページを新しいウィンドウで開く
      const printWindow = window.open('/print.html', '_blank', 'width=1200,height=800,scrollbars=yes');
      
      if (!printWindow) {
        alert('ポップアップがブロックされました。ブラウザの設定を確認してください。');
      }
    } catch (error) {
      console.error('印刷プレビューの表示エラー:', error);
      alert('印刷プレビューの表示中にエラーが発生しました。');
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
      
      // ブラウザから参照できるようにグローバルに設定
      window.currentJobId = jobId;
      console.log('[DEBUG] Set currentJobId:', jobId);
      
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
    // ブラウザから参照できるようにグローバルに設定
    window.currentJobId = jobId;
    console.log('[DEBUG] pollJobStatus - Set currentJobId:', jobId);
    
    let lastStepCount = 0;
    let lastSteps = [];
    const shownMessageIds = new Set(); // メッセージ重複表示防止用！
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const statusResponse = await fetch(`http://localhost:7071/api/research/status/${jobId}`)
        if (!statusResponse.ok) {
          throw new Error(`Status check failed: ${statusResponse.status}`)
        }
        const statusData = await statusResponse.json()
        console.log('[DEBUG] pollJobStatus - API response:', JSON.stringify(statusData, null, 2));

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
        
        // 📝 全メッセージのannotationsを事前に集約してグローバルマップを作成
        const globalAnnotationsMap = new Map();
        statusData.messages.forEach((msg, msgIndex) => {
          if (Array.isArray(msg.annotations)) {
            msg.annotations.forEach((annotation, annIndex) => {
              const key = `${msgIndex}:${annIndex}`;
              globalAnnotationsMap.set(key, annotation);
              console.log('[DEBUG] Added global annotation mapping:', key, annotation);
            });
          }
        });
        console.log('[DEBUG] Global annotations map created with keys:', Array.from(globalAnnotationsMap.keys()));
        
        statusData.messages.forEach((msg, messageIndex) => {
          console.log('[DEBUG] Processing message with messageIndex:', messageIndex, 'msg.id:', msg.id);
          if (msg.id && shownMessageIds.has(msg.id)) return; // 既に表示済みはスキップ
          let content = '';
          let references = [];
          let annotations = [];
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
          
          // annotations配列も取得！
          if (Array.isArray(msg.annotations)) {
            annotations = msg.annotations;
            console.log('[DEBUG] pollJobStatus - Message annotations found:', annotations);
          } else {
            console.log('[DEBUG] pollJobStatus - No annotations found:', msg.annotations);
          }
          
          // citations配列も取得！（annotations と同じデータを citations としても設定）
          let citations = [];
          if (Array.isArray(msg.citations)) {
            citations = msg.citations;
            console.log('[DEBUG] pollJobStatus - Message citations found:', citations);
          } else if (Array.isArray(msg.annotations)) {
            citations = msg.annotations; // annotationsをcitationsとしても使用
            console.log('[DEBUG] pollJobStatus - Using annotations as citations:', citations);
          } else {
            console.log('[DEBUG] pollJobStatus - No citations found:', msg.citations);
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
          console.log('[DEBUG] Adding message to this.messages with messageIndex:', messageIndex);
          this.messages = [
            ...this.messages,
            {
              type,
              content,
              references,
              annotations,  // annotations配列を追加！
              citations,    // citations配列も追加！
              messageIndex, // messageIndexを追加！
              globalAnnotationsMap, // グローバルannotationsマップを追加！
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

}

customElements.define('chat-app-v3', ChatApp)
