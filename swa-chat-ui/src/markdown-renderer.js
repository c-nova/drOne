export class MarkdownRenderer {
  static renderMarkdown(content, citations = [], jobContext = null, messageIndex = null, globalAnnotationsMap = null) {
    if (!content) return '';
    
    console.log('[DEBUG] Starting markdown render with:', {
      contentLength: content.length,
      citationsCount: citations?.length || 0,
      messageIndex,
      jobContext,
      globalAnnotationsMapSize: globalAnnotationsMap?.size || 0,
      citationsPreview: citations?.slice(0, 3) || []
    });

    let processedContent = content;
    const citationMap = new Map();
    let globalAnnotationIndex = 0;

    // Citationマッピングの処理
    if (citations && citations.length > 0) {
      console.log('[DEBUG] Processing citations for mapping');
      
      citations.forEach((citation, index) => {
        console.log('[DEBUG] Processing citation:', citation);
        
        // messageIndex:annotationIndex形式でマッピング
        if (messageIndex !== null && messageIndex !== undefined) {
          const citationKey = `${messageIndex}:${index}`;
          
          // url_citation タイプの処理
          if (citation.type === 'url_citation' && citation.url_citation) {
            const urlCitation = citation.url_citation;
            citationMap.set(citationKey, {
              url: urlCitation.url,
              title: urlCitation.title || urlCitation.url,
              source: 'Web'
            });
            console.log('[DEBUG] Added messageIndex:annotationIndex mapping:', citationKey, urlCitation.url);
          }
          // 他のタイプの処理
          else if (citation.url) {
            citationMap.set(citationKey, {
              url: citation.url,
              title: citation.title || citation.url,
              source: citation.source || 'Web'
            });
            console.log('[DEBUG] Added messageIndex:annotationIndex mapping (direct URL):', citationKey, citation.url);
          }
        }
        
        // 従来の形式もサポート
        if (citation.type === 'url_citation' && citation.url_citation) {
          const urlCitation = citation.url_citation;
          const citationData = {
            url: urlCitation.url,
            title: urlCitation.title || urlCitation.url,
            source: 'Web'
          };
          
          // textによるマッピング
          if (citation.text) {
            citationMap.set(citation.text, citationData);
            console.log('[DEBUG] Added text mapping:', citation.text, urlCitation.url);
          }
          
          // インデックスベースマッピング
          citationMap.set(index.toString(), citationData);
          console.log('[DEBUG] Added index mapping:', index, urlCitation.url);
          
          globalAnnotationIndex++;
        }
        // 新しいAPI形式の citation: {id, url, title}
        else if (citation.id && citation.url) {
          citationMap.set(citation.id, {
            url: citation.url,
            title: citation.title || citation.url,
            source: 'Web'
          });
          console.log('[DEBUG] Added new format citation:', citation.id, citation.url);
        }
        // 従来のcitation形式も継続サポート
        else if (citation.url) {
          const key = citation.title || citation.url;
          citationMap.set(key, citation);
          if (citation.index) {
            citationMap.set(citation.index, citation);
          }
        }
      });
      
      console.log('[DEBUG] Citation map created with keys:', Array.from(citationMap.keys()));
    }

    // Citation直後のカンマを事前処理（Citation処理の前に実行）
    console.log('[DEBUG] Before Citation comma processing:', processedContent.slice(0, 200));
    
    // パターン1: Citation,Citation の形式（Citationまたぎはそのまま残す）
    processedContent = processedContent.replace(/(【[^】]+】)\s*,\s*(【[^】]+】)/gm, (match, citation1, citation2) => {
      console.log('[DEBUG] Citation to Citation match:', { match, citation1, citation2 });
      return `${citation1},${citation2}`;  // カンマを残してスペースを除去
    });
    
    // パターン2: Citation,改行Citation の形式（Citationまたぎ対応）
    processedContent = processedContent.replace(/(【[^】]+】)\s*,\s*\n\s*(【[^】]+】)/gm, (match, citation1, citation2) => {
      console.log('[DEBUG] Citation crossing newline match:', { match, citation1, citation2 });
      return `${citation1},${citation2}`;  // 改行を削除してカンマで連結
    });
    
    // パターン3: Citation, 通常のテキスト の形式（bullet pointに変換）
    processedContent = processedContent.replace(/(【[^】]+】)\s*,\s*([^【\n,]+?)([:.：。]?)/gm, (match, citation, content, ending) => {
      console.log('[DEBUG] Citation comma to text match:', { match, citation, content, ending });
      return `${citation}\n- ${content}${ending}`;
    });
    
    console.log('[DEBUG] After Citation comma processing:', processedContent.slice(0, 200));

    // 変な文法エラーを修正（カンマ+句点の組み合わせなど）
    processedContent = processedContent.replace(/\s*,\s*。/g, '。'); // "です , 。" → "です。"
    processedContent = processedContent.replace(/\s*,\s*、/g, '、'); // カンマ+読点も修正

    // 【messageIndex:annotationIndex†source】パターンの処理（最優先）
    processedContent = processedContent.replace(/【(\d+):(\d+)†([^】]+)】/g, (match, messageIndex, annotationIndex, source) => {
      console.log(`[DEBUG] MessageIndex:AnnotationIndex pattern matched: ${match}, messageIndex=${messageIndex}, annotationIndex=${annotationIndex}, source=${source}`);
      console.log(`[DEBUG] Available citation keys:`, Array.from(citationMap.keys()));
      
      // 1. まず元のパターン（match全体）でマッピング検索
      let citationInfo = citationMap.get(match);
      console.log(`[DEBUG] Looking for full match: ${match}, found:`, citationInfo);
      
      if (!citationInfo) {
        // 2. messageIndex:annotationIndex形式でグローバルマップから検索
        const globalKey = `${messageIndex}:${annotationIndex}`;
        console.log(`[DEBUG] Looking for globalKey: ${globalKey} in globalAnnotationsMap`);
        
        if (globalAnnotationsMap && globalAnnotationsMap.has(globalKey)) {
          const annotation = globalAnnotationsMap.get(globalKey);
          console.log(`[DEBUG] Found annotation in globalMap:`, annotation);
          
          // annotationからURL情報を抽出
          if (annotation.type === 'url_citation' && annotation.url_citation) {
            citationInfo = {
              url: annotation.url_citation.url,
              title: annotation.url_citation.title || annotation.url_citation.url
            };
          } else if (annotation.url) {
            citationInfo = {
              url: annotation.url,
              title: annotation.title || annotation.url
            };
          }
          console.log(`[DEBUG] Extracted citationInfo from globalMap:`, citationInfo);
        }
        
        // 3. ローカルcitationMapでも検索（従来の方式）
        if (!citationInfo) {
          const citationKey = `${messageIndex}:${annotationIndex}`;
          citationInfo = citationMap.get(citationKey);
          console.log(`[DEBUG] Looking for citationKey: ${citationKey}, found:`, citationInfo);
        }
      }
      
      if (citationInfo) {
        console.log('[DEBUG] Found citation mapping:', citationInfo);
        return `<a href="${citationInfo.url}" target="_blank" class="citation-link" title="${citationInfo.title}">【${messageIndex}:${annotationIndex}†${source}】</a>`;
      } else {
        console.log('[DEBUG] No citation mapping found for:', match);
        console.log('[DEBUG] Falling back to jobContext search. JobContext:', jobContext);
        // フォールバック: jobContextからキーワード検索
        if (jobContext) {
          const jobTitle = jobContext.title || jobContext.query;
          if (jobTitle) {
            // ジョブタイトルから主要キーワードを抽出
            const keywords = jobTitle.split(' ').filter(word => 
              word.length > 2 && !['です', 'ます', 'から', 'まで', 'について'].includes(word)
            ).slice(0, 3).join(' ');
            
            console.log(`[DEBUG] Extracted keywords from jobTitle: "${jobTitle}" -> "${keywords}"`);
            
            if (keywords) {
              const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keywords)}`;
              console.log(`[DEBUG] Generated fallback search URL: ${searchUrl}`);
              return `<a href="${searchUrl}" target="_blank" class="citation-link fallback" title="Search: ${keywords}">${source}</a>`;
            }
          }
        }
        return `<span class="citation-text broken" title="Citation not found">${source}</span>`;
      }
    });

    // 【数字†source】パターンの処理
    processedContent = processedContent.replace(/【(\d+)†([^】]+)】/g, (match, num, source) => {
      console.log(`[DEBUG] Number pattern matched: ${match}, num=${num}, source=${source}`);
      
      const citationInfo = citationMap.get(num) || citationMap.get(num.toString());
      
      if (citationInfo) {
        console.log('[DEBUG] Found citation for number:', num, citationInfo);
        return `<a href="${citationInfo.url}" target="_blank" class="citation-link" title="${citationInfo.title}">【${num}†${source}】</a>`;
      } else {
        console.log('[DEBUG] No citation found for number:', num);
        if (jobContext) {
          const jobTitle = jobContext.title || jobContext.query;
          if (jobTitle) {
            const keywords = jobTitle.split(' ').filter(word => 
              word.length > 2 && !['です', 'ます', 'から', 'まで', 'について'].includes(word)
            ).slice(0, 3).join(' ');
            
            if (keywords) {
              const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keywords)}`;
              return `<a href="${searchUrl}" target="_blank" class="citation-link fallback" title="Search: ${keywords}">【${num}†${source}】</a>`;
            }
          }
        }
        return `<span class="citation-text broken" title="Citation not found">【${num}†${source}】</span>`;
      }
    });

    // 他のCitationパターンの処理
    processedContent = processedContent.replace(/【([^】]+)】/g, (match, content) => {
      console.log(`[DEBUG] General citation pattern: ${match}, content=${content}`);
      
      const citationInfo = citationMap.get(content);
      if (citationInfo) {
        return `<a href="${citationInfo.url}" target="_blank" class="citation-link" title="${citationInfo.title}">【${content}】</a>`;
      }
      
      return `<span class="citation-text">【${content}】</span>`;
    });

    // Markdownの基本処理
    // テーブル処理（先に処理）
    processedContent = processedContent.replace(/\|(.+)\|\s*\n\|[-\s|]+\|\s*\n((?:\|.+\|\s*\n?)+)/g, (match, header, rows) => {
      const headerCells = header.split('|').map(cell => cell.trim()).filter(cell => cell);
      const rowLines = rows.trim().split('\n');
      
      let tableHtml = '<table border="1" style="border-collapse: collapse; margin: 10px 0;"><thead><tr>';
      headerCells.forEach(cell => {
        tableHtml += `<th style="border: 1px solid #ddd; padding: 8px; background: #f5f5f5;">${cell}</th>`;
      });
      tableHtml += '</tr></thead><tbody>';
      
      rowLines.forEach(row => {
        if (row.trim()) {
          const cells = row.split('|').map(cell => cell.trim()).filter(cell => cell);
          tableHtml += '<tr>';
          cells.forEach(cell => {
            tableHtml += `<td style="border: 1px solid #ddd; padding: 8px;">${cell}</td>`;
          });
          tableHtml += '</tr>';
        }
      });
      
      tableHtml += '</tbody></table>';
      return tableHtml;
    });
    
    // 太字（改良版: 前後のスペースがなくても動作）
    // まず、スペースが余分についているパターンを修正
    processedContent = processedContent.replace(/\*\* ([^*]+?) \*\*/g, '**$1**');
    // 次に、通常の太字を処理
    processedContent = processedContent.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    
    // 斜体
    processedContent = processedContent.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // 行頭のハッシュ記号による見出し
    processedContent = processedContent.replace(/^### (.*$)/gm, '<h3>$1</h3>');
    processedContent = processedContent.replace(/^## (.*$)/gm, '<h2>$1</h2>');
    processedContent = processedContent.replace(/^# (.*$)/gm, '<h1>$1</h1>');
    
    // 引用ブロック（blockquote）- 連続する>行をまとめて処理
    processedContent = processedContent.replace(/(^> .*(\n^> .*)*)/gm, (match) => {
      // 各行から>を除去してblockquote内容を作成
      const content = match.replace(/^> /gm, '');
      return `<blockquote>${content}</blockquote>`;
    });
    
    // リスト（番号付き）
    processedContent = processedContent.replace(/^\d+\.\s(.*)$/gm, '<li>$1</li>');
    processedContent = processedContent.replace(/(<li>.*<\/li>)/s, '<ol>$1</ol>');
    
    // カンマをハイフンリストに変換（Markdownリスト処理の前に実行）
    // 文頭のカンマやハイフンを統一してMarkdownリスト形式に変換
    processedContent = processedContent.replace(/^[,\-]\s*([^,\n]+?)([:.：。]?)$/gm, '- $1$2');
    processedContent = processedContent.replace(/\n[,\-]\s*([^,\n]+?)([:.：。]?)/g, '\n- $1$2');
    
    // リスト（番号なし）
    processedContent = processedContent.replace(/^[-*]\s(.*)$/gm, '<li>$1</li>');
    
    // 改行をbrタグに変換
    processedContent = processedContent.replace(/\n/g, '<br>');
    
    console.log('[DEBUG] Markdown rendering completed');
    return processedContent;
  }
}
