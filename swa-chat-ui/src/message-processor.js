// Azure AI Foundryメッセージ処理のユーティリティクラス
export class MessageProcessor {
  
  /**
   * Azure AI Foundryの生メッセージからコンテンツを抽出
   */
  static extractContent(msgContent) {
    if (Array.isArray(msgContent)) {
      return msgContent.map(c => typeof c === 'string' ? c : JSON.stringify(c)).join('\n');
    } 
    
    if (typeof msgContent === 'string') {
      return msgContent;
    } 
    
    if (msgContent && typeof msgContent === 'object') {
      if (typeof msgContent.text === 'string') {
        return msgContent.text;
      } 
      
      if (Array.isArray(msgContent.parts)) {
        return msgContent.parts.map(p => p.text).join('\n');
      } 
      
      return JSON.stringify(msgContent);
    }
    
    return '';
  }

  /**
   * Azure AI Foundryの生メッセージからannotationsを抽出
   */
  static extractAnnotations(msgObj) {
    if (Array.isArray(msgObj.annotations)) {
      return msgObj.annotations;
    }
    return [];
  }

  /**
   * citations, references, urls, sourcesからreferences配列を構築
   */
  static extractReferences(msgObj) {
    const references = [];

    // citations処理
    if (Array.isArray(msgObj.citations)) {
      msgObj.citations.forEach(cite => {
        if (cite.url) {
          references.push({ url: cite.url, title: cite.title || cite.url });
        } else if (typeof cite === 'string') {
          const urlMatch = cite.match(/https?:\/\/[^\s]+/);
          if (urlMatch) {
            references.push({ url: urlMatch[0], title: cite });
          } else {
            references.push({ url: '', title: cite });
          }
        } else if (cite.title) {
          const urlMatch = cite.title.match(/https?:\/\/[^\s]+/);
          if (urlMatch) {
            references.push({ url: urlMatch[0], title: cite.title });
          } else {
            references.push({ url: '', title: cite.title });
          }
        }
      });
    }

    // references処理
    if (Array.isArray(msgObj.references)) {
      msgObj.references.forEach(ref => {
        references.push({ 
          url: ref.url || ref, 
          title: ref.title || ref.url || ref 
        });
      });
    }

    // urls処理
    if (Array.isArray(msgObj.urls)) {
      msgObj.urls.forEach(url => {
        references.push({ url: url, title: url });
      });
    }

    // sources処理
    if (Array.isArray(msgObj.sources)) {
      msgObj.sources.forEach(src => {
        references.push({ url: src, title: src });
      });
    }

    return references;
  }

  /**
   * Azure AI Foundryの生メッセージを統一フォーマットに変換
   */
  static processMessage(rawMsg, jobId) {
    const content = this.extractContent(rawMsg.content);
    const annotations = this.extractAnnotations(rawMsg);
    const references = this.extractReferences(rawMsg);
    
    const type = rawMsg.role === 'user' ? 'user' : 'ai';
    
    return {
      type,
      content,
      annotations,
      references,
      jobId: jobId,
      messageId: rawMsg.id,
      timestamp: rawMsg.created_at || ''
    };
  }

  /**
   * 複数のメッセージを一括処理
   */
  static processMessages(rawMessages, jobId) {
    if (!Array.isArray(rawMessages)) {
      throw new Error('messages配列が見つからないよ！');
    }

    return rawMessages.map(msg => this.processMessage(msg, jobId));
  }

  /**
   * 失敗ジョブ用のエラーメッセージを生成
   */
  static createErrorMessage(data, jobId) {
    return {
      type: 'ai',
      content: `❌ **調査は途中で失敗しましたが、以下に取得できた情報を表示します**

**エラー**: ${data.error_message}
**実行時間**: ${data.created_at} ～ ${data.completed_at}
**Thread ID**: ${data.thread_id}
**Run ID**: ${data.run_id}

---

**💡 この調査を再試行する場合は、より具体的な質問に分割することをお勧めします:**

1. "BigQueryからMicrosoft Fabricへの移行のメリットとデメリット"
2. "BigQueryからAzure Databricksへの移行手順"  
3. "BigQueryユーザーの説得材料"

など、より短い質問に分けて試してみてください。

---

**取得できた調査内容:**`,
      jobId: jobId,
      timestamp: data.created_at || ''
    };
  }

  /**
   * 失敗ジョブのステップ履歴メッセージを生成
   */
  static createStepsMessage(data, jobId) {
    if (!Array.isArray(data.steps) || data.steps.length === 0) {
      return null;
    }

    let stepsContent = '\n\n---\n\n**🔄 実行ステップ履歴:**\n\n';
    data.steps.forEach(step => {
      const timestamp = step.timestamp || '';
      stepsContent += `- **${step.step_name}** (${timestamp}): ${step.step_details}\n`;
    });

    return {
      type: 'ai',
      content: stepsContent,
      jobId: jobId,
      timestamp: data.completed_at || ''
    };
  }
}
