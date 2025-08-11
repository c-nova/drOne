// ファイルエクスポート機能のユーティリティクラス
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType } from 'docx'
import { MarkdownRenderer } from './markdown-renderer.js'

export class FileExporter {
  
  // PDFダウンロード
  static async downloadAsPDF(content) {
    console.log('[DEBUG] downloadAsPDF called with content:', content?.length, 'characters');
    try {
      // 一時的な要素を作成してマークダウンをレンダリング
      const tempDiv = document.createElement('div')
      tempDiv.innerHTML = MarkdownRenderer.renderMarkdown(content)
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

  // Wordダウンロード
  static async downloadAsWord(content, references = []) {
    console.log('[DEBUG] downloadAsWord called with content:', content?.length, 'characters, references:', references?.length);
    try {
      const children = [];
      
      // タイトル
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: 'Deep Research Report',
              bold: true,
              size: 32,
            }),
          ],
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
        })
      );
      
      // 生成日時
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `生成日時: ${new Date().toLocaleString('ja-JP')}`,
              size: 20,
              color: '666666',
            }),
          ],
          alignment: AlignmentType.CENTER,
        })
      );
      
      children.push(new Paragraph({ text: '' })); // 空行
      
      // マークダウンを簡単にパースしてWord要素に変換
      const lines = content.split('\n');
      let currentParagraph = '';
      let i = 0;
      
      while (i < lines.length) {
        const line = lines[i];
        const trimmedLine = line.trim();
        
        // テーブル検出（| で始まる行）
        if (trimmedLine.includes('|') && trimmedLine.split('|').length >= 3) {
          // 前の段落があれば追加
          if (currentParagraph) {
            children.push(FileExporter.createWordParagraph(currentParagraph));
            currentParagraph = '';
          }
          
          // テーブル行を収集
          const tableLines = [];
          let j = i;
          while (j < lines.length && lines[j].trim().includes('|')) {
            const tableLine = lines[j].trim();
            // セパレーター行（|---|---|）をスキップ
            if (!tableLine.match(/^\|[\s\-\|:]+\|$/)) {
              tableLines.push(tableLine);
            }
            j++;
          }
          
          if (tableLines.length > 0) {
            // Wordテーブルを作成
            const table = FileExporter.createWordTable(tableLines);
            children.push(table);
            children.push(new Paragraph({ text: '' })); // テーブル後の空行
          }
          
          i = j - 1; // ループのインデックスを調整
        } else if (trimmedLine.startsWith('### ')) {
          // 前の段落があれば追加
          if (currentParagraph) {
            children.push(FileExporter.createWordParagraph(currentParagraph));
            currentParagraph = '';
          }
          // H3見出し
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: trimmedLine.substring(4),
                  bold: true,
                  size: 24,
                }),
              ],
              heading: HeadingLevel.HEADING_3,
            })
          );
        } else if (trimmedLine.startsWith('## ')) {
          // 前の段落があれば追加
          if (currentParagraph) {
            children.push(FileExporter.createWordParagraph(currentParagraph));
            currentParagraph = '';
          }
          // H2見出し
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: trimmedLine.substring(3),
                  bold: true,
                  size: 28,
                }),
              ],
              heading: HeadingLevel.HEADING_2,
            })
          );
        } else if (trimmedLine.startsWith('# ')) {
          // 前の段落があれば追加
          if (currentParagraph) {
            children.push(FileExporter.createWordParagraph(currentParagraph));
            currentParagraph = '';
          }
          // H1見出し
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: trimmedLine.substring(2),
                  bold: true,
                  size: 32,
                }),
              ],
              heading: HeadingLevel.HEADING_1,
            })
          );
        } else if (trimmedLine === '') {
          // 空行で段落区切り
          if (currentParagraph) {
            children.push(FileExporter.createWordParagraph(currentParagraph));
            currentParagraph = '';
            children.push(new Paragraph({ text: '' })); // 空行
          }
        } else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
          // リスト項目
          if (currentParagraph) {
            children.push(FileExporter.createWordParagraph(currentParagraph));
            currentParagraph = '';
          }
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `• ${trimmedLine.substring(2)}`,
                  size: 22,
                }),
              ],
            })
          );
        } else {
          // 通常のテキスト行
          if (currentParagraph) {
            currentParagraph += '\n' + line;
          } else {
            currentParagraph = line;
          }
        }
        
        i++;
      }
      
      // 最後の段落を追加
      if (currentParagraph) {
        children.push(FileExporter.createWordParagraph(currentParagraph));
      }
      
      // 参考URLセクション
      if (references && references.length > 0) {
        children.push(new Paragraph({ text: '' })); // 空行
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: '参考URL',
                bold: true,
                size: 24,
              }),
            ],
            heading: HeadingLevel.HEADING_3,
          })
        );
        
        references.forEach(ref => {
          if (ref.url) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `• ${ref.title || ref.url}`,
                    size: 22,
                  }),
                  new TextRun({
                    text: `\n  ${ref.url}`,
                    size: 20,
                    color: '0066CC',
                  }),
                ],
              })
            );
          }
        });
      }
      
      // Word文書を作成
      const doc = new Document({
        sections: [
          {
            properties: {},
            children: children,
          },
        ],
      });
      
      // ファイルを生成してダウンロード（ブラウザ用）
      const blob = await Packer.toBlob(doc);
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      a.download = `deep-research-report-${timestamp}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
    } catch (error) {
      console.error('Word download error:', error);
      alert('Word文書の生成に失敗しました: ' + error.message);
    }
  }

  // Word用段落作成ヘルパー
  static createWordParagraph(text) {
    // **太字**、*斜体*、`コード`を処理
    const runs = [];
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/);
    
    for (const part of parts) {
      if (part.startsWith('**') && part.endsWith('**')) {
        // 太字
        runs.push(new TextRun({
          text: part.slice(2, -2),
          bold: true,
          size: 22,
        }));
      } else if (part.startsWith('*') && part.endsWith('*')) {
        // 斜体
        runs.push(new TextRun({
          text: part.slice(1, -1),
          italics: true,
          size: 22,
        }));
      } else if (part.startsWith('`') && part.endsWith('`')) {
        // コード
        runs.push(new TextRun({
          text: part.slice(1, -1),
          font: 'Courier New',
          size: 20,
          color: '333333',
        }));
      } else if (part.trim()) {
        // 通常テキスト
        runs.push(new TextRun({
          text: part,
          size: 22,
        }));
      }
    }
    
    return new Paragraph({
      children: runs,
    });
  }

  // Wordテーブル作成ヘルパー
  static createWordTable(tableLines) {
    const rows = [];
    
    tableLines.forEach((line, index) => {
      // | で分割してセルを取得
      const cells = line.split('|')
        .map(cell => cell.trim())
        .filter(cell => cell !== ''); // 空のセルを除去
      
      if (cells.length === 0) return;
      
      const tableCells = cells.map(cellText => {
        return new TableCell({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: cellText,
                  size: 20,
                  bold: index === 0, // 最初の行はヘッダーとして太字
                }),
              ],
            }),
          ],
          width: {
            size: Math.floor(100 / cells.length), // 均等幅
            type: WidthType.PERCENTAGE,
          },
        });
      });
      
      rows.push(new TableRow({
        children: tableCells,
      }));
    });
    
    return new Table({
      rows: rows,
      width: {
        size: 100,
        type: WidthType.PERCENTAGE,
      },
    });
  }

  // マークダウンダウンロード
  static downloadAsMarkdown(content) {
    console.log('[DEBUG] downloadAsMarkdown called with content:', content?.length, 'characters');
    try {
      let markdown = content;
      // 参考URLの処理は後で追加予定
      
      const blob = new Blob([markdown], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
      a.download = `deep-research-report-${timestamp}.md`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      console.log('[DEBUG] downloadAsMarkdown completed successfully');
    } catch (error) {
      console.error('[DEBUG] downloadAsMarkdown error:', error);
      alert('マークダウンのダウンロードに失敗しました: ' + error.message);
    }
  }

  // クリップボードにコピー
  static async copyToClipboard(content, shadowRoot) {
    console.log('[DEBUG] copyToClipboard called with content:', content?.length, 'characters');
    try {
      await navigator.clipboard.writeText(content)
      // 一時的な成功表示 - イベントを正しく取得
      const buttons = shadowRoot.querySelectorAll('.action-btn')
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
