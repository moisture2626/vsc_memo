# VSC Memo

VSCodeのメモ機能拡張です。

## 機能

- TODOリストの作成・編集
- Markdownファイルとして保存・読み込み
- 左サイドバーのWebViewで操作

## 使い方

1. F5キーを押して拡張機能を実行
2. 左のサイドバーにメモアイコンが表示されます
3. "Select MD File"ボタンでMarkdownファイルを選択
4. "Add TODO"ボタンでTODO項目を追加
5. 各項目を編集し、チェックボックスで完了/未完了を切り替え
6. "Delete"ボタンで項目を削除
7. "Save"ボタンでファイルに保存

## 開発

```bash
# 依存関係のインストール
npm install

# コンパイル
npm run compile

# 監視モードでコンパイル
npm run watch
```

## ライセンス

MIT
