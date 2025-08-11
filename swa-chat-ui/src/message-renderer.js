import { html } from 'lit';
import { MarkdownRenderer } from './markdown-renderer.js';

// メッセージ表示とフォーマット処理のユーティリティクラス
export class MessageRenderer {
  
  // メッセージごとの描画を分岐で返す
  static renderMessage(msg, formatDuration) {
    // ジョブコンテキストを動的に生成（現在の文脈から）
    const jobContext = MessageRenderer.createJobContext(msg);
    
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
                実行時間: ${formatDuration(
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
            <div class="markdown-content" .innerHTML="${MarkdownRenderer.renderMarkdown(msg.content, msg.annotations || msg.citations, jobContext, msg.messageIndex, msg.globalAnnotationsMap)}"></div>
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
            <button class="action-btn pdf-btn" data-content="${msg.content}" @click="${(e) => window.chatApp.handleActionButtonClick(e)}">
              📄 PDF
            </button>
            <button class="action-btn print-preview-btn" @click="${(e) => window.chatApp.handleActionButtonClick(e)}">
              🖨️ PDF用表示
            </button>
            <button class="action-btn word-btn" data-content="${msg.content}" data-references="${JSON.stringify(msg.references || [])}" @click="${(e) => window.chatApp.handleActionButtonClick(e)}">
              📝 Word
            </button>
            <button class="action-btn md-btn" data-content="${msg.content}" @click="${(e) => window.chatApp.handleActionButtonClick(e)}">
              📋 MD
            </button>
            <button class="action-btn copy-btn" data-content="${msg.content}" @click="${(e) => window.chatApp.handleActionButtonClick(e)}">
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
  static formatDuration(duration) {
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const seconds = duration % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }

  // ジョブコンテキストを動的に生成
  static createJobContext(msg) {
    // メッセージ内容やヘッダー、履歴から文脈情報を取得
    let jobTitle = '';
    let keywords = [];
    
    // 現在表示中のタイトルやクエリを推測
    try {
      // DOM から現在のジョブ情報を取得を試みる
      const chatApp = document.querySelector('chat-app-v3');
      if (chatApp && chatApp.shadowRoot) {
        // 履歴の選択されたアイテムからタイトルを取得
        const activeItem = chatApp.shadowRoot.querySelector('.history-item.active, .history-item:hover');
        if (activeItem) {
          const titleElement = activeItem.querySelector('.history-item-content');
          if (titleElement) {
            jobTitle = titleElement.textContent.trim();
          }
        }
      }
      
      // メッセージ内容から重要なキーワードを抽出
      if (msg.content) {
        const content = msg.content;
        
        // 主要テクノロジー・サービス名を抽出
        const techKeywords = content.match(/\b(BigQuery|Microsoft Fabric|Azure|Google Cloud|GCP|Synapse|Power BI|Data Factory|OneLake|Dataflow|Vertex AI|Looker|Tableau|Databricks|Data Analytics|Machine Learning|AI|Cloud|Migration|comparison|比較|移行)\b/gi) || [];
        keywords = [...new Set(techKeywords)]; // 重複除去
        
        // cot_summary から重要な動詞・形容詞を抽出
        const cotSummaryMatch = content.match(/cot_summary:\s*\*\*([^*]+)\*\*/i);
        if (cotSummaryMatch) {
          keywords.unshift(cotSummaryMatch[1].trim());
        }
        
        // 見出しから重要な情報を抽出
        const headings = content.match(/^#+\s+(.+)$/gm) || [];
        headings.forEach(heading => {
          const cleanHeading = heading.replace(/^#+\s*/, '').trim();
          if (cleanHeading.length < 80 && !cleanHeading.toLowerCase().includes('report')) {
            keywords.push(cleanHeading);
          }
        });
        
        // メッセージの最初の段落から要約的な文章を抽出
        const paragraphs = content.split('\n\n').filter(p => p.trim().length > 0);
        for (const paragraph of paragraphs.slice(0, 3)) {
          const cleanPara = paragraph.replace(/^[#*\-\s]+/, '').trim();
          if (cleanPara.length > 20 && cleanPara.length < 150 && 
              !cleanPara.toLowerCase().includes('final report') && 
              !cleanPara.startsWith('cot_summary')) {
            keywords.push(cleanPara);
            break;
          }
        }
        
        // 一般的なフォールバック: メッセージ内容の最初の行やヘッダーから推測
        if (keywords.length === 0) {
          const firstLine = content.split('\n')[0];
          if (firstLine.startsWith('#')) {
            jobTitle = firstLine.replace(/^#+\s*/, '').trim();
          } else if (firstLine.length < 100) {
            jobTitle = firstLine.trim();
          }
        }
      }
      
      // キーワードから最適なタイトルを構築
      if (keywords.length > 0) {
        // 最初の3つのキーワードを使用して検索クエリを構築
        jobTitle = keywords.slice(0, 3).join(' ');
        console.log('[DEBUG] createJobContext - Extracted keywords:', keywords);
        console.log('[DEBUG] createJobContext - Final jobTitle:', jobTitle);
      }
      
      // さらなるフォールバック: 一般的なキーワード
      if (!jobTitle) {
        jobTitle = 'data analytics research comparison';
        console.log('[DEBUG] createJobContext - Using fallback jobTitle:', jobTitle);
      }
      
    } catch (error) {
      console.warn('[DEBUG] Failed to extract job context:', error);
      jobTitle = 'data analytics research';
    }
    
    console.log('[DEBUG] createJobContext - Final result:', { title: jobTitle, query: jobTitle });
    
    return {
      title: jobTitle,
      query: jobTitle
    };
  }
}
