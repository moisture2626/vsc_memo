import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class MemoViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'vscMemoView';

    private _view?: vscode.WebviewView;
    private _context?: vscode.ExtensionContext;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        context?: vscode.ExtensionContext
    ) {
        this._context = context;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // WebViewからのメッセージを処理
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'selectFile':
                    await this._selectFile();
                    break;
                case 'saveToFile':
                    await this._saveToFile(data.filePath, data.todos);
                    break;
                case 'loadFromFile':
                    await this._loadFromFile(data.filePath);
                    break;
                case 'ready':
                    // WebViewの準備ができたら、保存されたファイルを読み込む
                    await this._loadLastOpenedFile();
                    break;
            }
        });
    }

    private async _loadLastOpenedFile() {
        if (!this._context) {
            return;
        }

        // ワークスペースごとのファイルパスを取得
        const workspaceKey = this._getWorkspaceKey();
        const lastFilePath = this._context.workspaceState.get<string>(`lastMemoFile_${workspaceKey}`);

        if (lastFilePath && fs.existsSync(lastFilePath)) {
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'fileSelected',
                    filePath: lastFilePath
                });
            }
            await this._loadFromFile(lastFilePath);
        }
    }

    private _getWorkspaceKey(): string {
        // ワークスペースフォルダのパスをキーとして使用
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            return workspaceFolders[0].uri.fsPath;
        }
        return 'default';
    }

    private _saveLastOpenedFile(filePath: string) {
        if (!this._context) {
            return;
        }

        const workspaceKey = this._getWorkspaceKey();
        this._context.workspaceState.update(`lastMemoFile_${workspaceKey}`, filePath);
    }

    private async _selectFile() {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: 'Select',
            filters: {
                'Markdown files': ['md']
            }
        };

        const fileUri = await vscode.window.showOpenDialog(options);
        if (fileUri && fileUri[0]) {
            const filePath = fileUri[0].fsPath;
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'fileSelected',
                    filePath: filePath
                });
            }
            // ファイルを設定に保存
            this._saveLastOpenedFile(filePath);
            // ファイルが存在する場合、内容を読み込む
            await this._loadFromFile(filePath);
        }
    }

    private async _loadFromFile(filePath: string) {
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                const todos = this._parseMdToTodos(content);
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'todosLoaded',
                        todos: todos
                    });
                }
                // ファイルを設定に保存
                this._saveLastOpenedFile(filePath);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load file: ${error}`);
        }
    }

    private async _saveToFile(filePath: string, todos: any[]) {
        try {
            let targetPath = filePath;

            // ファイルが指定されていない場合は新規保存ダイアログを表示
            if (!targetPath) {
                const saveUri = await vscode.window.showSaveDialog({
                    filters: {
                        'Markdown files': ['md']
                    },
                    defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri
                });

                if (!saveUri) {
                    // ユーザーがキャンセルした場合
                    return;
                }

                targetPath = saveUri.fsPath;

                // 新しいファイルパスをWebViewに通知
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'fileSelected',
                        filePath: targetPath
                    });
                }
            }

            const mdContent = this._todosToMd(todos);

            // ディレクトリが存在しない場合は作成
            const dir = path.dirname(targetPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(targetPath, mdContent, 'utf8');
            vscode.window.showInformationMessage('TODO list saved successfully!');

            // ファイルを設定に保存
            this._saveLastOpenedFile(targetPath);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to save file: ${error}`);
        }
    }

    private _todosToMd(todos: any[]): string {
        let md = '# TODO List\n\n';
        todos.forEach((todo, index) => {
            const checkbox = todo.completed ? '[x]' : '[ ]';
            // HTMLをプレーンテキストに変換
            const text = this._htmlToPlainText(todo.text);
            const lines = text.split('\n');

            // 最初の行
            md += `${index + 1}. ${checkbox} ${lines[0] || ''}\n`;

            // 2行目以降はインデント
            for (let i = 1; i < lines.length; i++) {
                md += `   ${lines[i]}\n`;
            }

            // HTMLコンテンツをコメントとして保存（リッチテキスト情報を保持）
            if (todo.text && todo.text !== text) {
                const encodedHtml = Buffer.from(todo.text).toString('base64');
                md += `   <!-- html:${encodedHtml} -->\n`;
            }
        });
        return md;
    }

    private _htmlToPlainText(html: string): string {
        if (!html) return '';
        // HTMLタグを削除してプレーンテキストに変換
        return html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<\/li>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .trim();
    }

    private _parseMdToTodos(content: string): any[] {
        const todos: any[] = [];
        const lines = content.split('\n');
        let currentTodo: any = null;
        let htmlContent: string = '';

        for (const line of lines) {
            // HTMLコメントからリッチテキストを復元
            const htmlMatch = line.match(/<!--\s*html:([A-Za-z0-9+/=]+)\s*-->/);
            if (htmlMatch && currentTodo) {
                try {
                    htmlContent = Buffer.from(htmlMatch[1], 'base64').toString('utf8');
                    currentTodo.text = htmlContent;
                } catch (e) {
                    // デコードエラーの場合は無視
                }
                continue;
            }

            // マッチパターン: "1. [x] テキスト" または "1. [ ] テキスト"
            const match = line.match(/^\d+\.\s*\[(x| )\]\s*(.*)$/i);
            if (match) {
                // 前のTODOがあれば保存
                if (currentTodo) {
                    todos.push(currentTodo);
                }
                // 新しいTODOを開始
                currentTodo = {
                    text: match[2].trim(),
                    completed: match[1].toLowerCase() === 'x'
                };
                htmlContent = '';
            } else if (currentTodo && line.match(/^\s{3,}/) && !line.includes('<!--')) {
                // インデントされた行は前のTODOの続き（HTMLコメント以外）
                const trimmedLine = line.trim();
                if (trimmedLine) {
                    currentTodo.text += '\n' + trimmedLine;
                }
            }
        }

        // 最後のTODOを保存
        if (currentTodo) {
            todos.push(currentTodo);
        }

        return todos;
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TODO List</title>
    <style>
        body {
            padding: 10px;
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
        }
        .file-selector {
            margin-bottom: 20px;
        }
        .file-path {
            display: block;
            padding: 5px;
            margin: 5px 0;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            border-radius: 2px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 14px;
            cursor: pointer;
            margin: 5px 5px 5px 0;
            border-radius: 2px;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .todo-list {
            margin-top: 20px;
        }
        .todo-item {
            display: flex;
            flex-direction: column;
            margin: 8px 0;
            padding: 8px;
            background-color: var(--vscode-editor-background);
            border-radius: 3px;
        }
        .todo-header {
            display: flex;
            align-items: center;
            margin-bottom: 8px;
            gap: 8px;
        }
        .todo-header input[type="checkbox"] {
            cursor: pointer;
            flex-shrink: 0;
        }
        .todo-header .delete-btn {
            margin-left: auto;
        }
        .todo-content {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .todo-editor {
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 8px;
            border-radius: 2px;
            min-height: 28px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            line-height: 1.6;
            overflow-wrap: break-word;
            word-wrap: break-word;
        }
        .todo-editor:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }
        .todo-editor ul, .todo-editor ol {
            margin: 4px 0;
            padding-left: 20px;
        }
        .todo-editor li {
            margin: 2px 0;
        }
        .todo-editor p {
            margin: 4px 0;
        }
        .todo-editor strong {
            font-weight: bold;
        }
        .todo-editor em {
            font-style: italic;
        }
        .todo-item.completed .todo-editor {
            text-decoration: line-through;
            opacity: 0.6;
        }
        .toolbar {
            display: flex;
            gap: 4px;
            padding: 4px;
            background-color: var(--vscode-editor-background);
            border-radius: 2px;
        }
        .toolbar button {
            padding: 4px 8px;
            font-size: 11px;
            min-width: 30px;
        }
        .delete-btn {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            padding: 4px 10px;
            font-size: 12px;
        }
        .delete-btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .add-btn {
            margin-top: 10px;
        }
        .save-btn {
            background-color: var(--vscode-button-background);
            margin-top: 15px;
        }
    </style>
</head>
<body>
    <div class="file-selector">
        <h3>File Selection</h3>
        <button id="selectFileBtn">Select MD File</button>
        <div class="file-path" id="filePath">No file selected</div>
    </div>

    <div class="todo-list">
        <h3>TODO List</h3>
        <div id="todoContainer"></div>
        <button class="add-btn" id="addBtn">Add TODO</button>
        <button class="save-btn" id="saveBtn">Save</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentFilePath = '';
        let todos = [];

        // ファイル選択ボタン
        document.getElementById('selectFileBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'selectFile' });
        });

        // 追加ボタン
        document.getElementById('addBtn').addEventListener('click', () => {
            todos.push({ text: '', completed: false });
            renderTodos();
        });

        // 保存ボタン
        document.getElementById('saveBtn').addEventListener('click', () => {
            vscode.postMessage({
                type: 'saveToFile',
                filePath: currentFilePath,
                todos: todos
            });
        });

        // TODOリストをレンダリング
        function renderTodos() {
            const container = document.getElementById('todoContainer');
            container.innerHTML = '';

            todos.forEach((todo, index) => {
                const todoItem = document.createElement('div');
                todoItem.className = 'todo-item' + (todo.completed ? ' completed' : '');

                // ヘッダー部分 (チェックボックスとDeleteボタン)
                const todoHeader = document.createElement('div');
                todoHeader.className = 'todo-header';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = todo.completed;
                checkbox.addEventListener('change', (e) => {
                    todos[index].completed = e.target.checked;
                    renderTodos();
                });

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-btn';
                deleteBtn.textContent = 'Delete';
                deleteBtn.addEventListener('click', () => {
                    todos.splice(index, 1);
                    renderTodos();
                });

                todoHeader.appendChild(checkbox);
                todoHeader.appendChild(deleteBtn);

                // コンテンツ部分 (ツールバーとエディタ)
                const todoContent = document.createElement('div');
                todoContent.className = 'todo-content';

                // ツールバー
                const toolbar = document.createElement('div');
                toolbar.className = 'toolbar';

                const createToolbarBtn = (label, command) => {
                    const btn = document.createElement('button');
                    btn.textContent = label;
                    btn.title = command;
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        document.execCommand(command, false, null);
                        editor.focus();
                    });
                    return btn;
                };

                toolbar.appendChild(createToolbarBtn('B', 'bold'));
                toolbar.appendChild(createToolbarBtn('I', 'italic'));
                toolbar.appendChild(createToolbarBtn('•', 'insertUnorderedList'));
                toolbar.appendChild(createToolbarBtn('1.', 'insertOrderedList'));

                // contenteditable エディタ
                const editor = document.createElement('div');
                editor.className = 'todo-editor';
                editor.contentEditable = 'true';
                editor.innerHTML = todo.text || '<p><br></p>';

                editor.addEventListener('input', () => {
                    todos[index].text = editor.innerHTML;
                });

                // ペーストイベント - プレーンテキストのみ許可
                editor.addEventListener('paste', (e) => {
                    e.preventDefault();
                    if (e.clipboardData) {
                        const text = e.clipboardData.getData('text/plain');
                        if (text) {
                            // execCommand('insertText')が失敗した場合は直接挿入
                            const success = document.execCommand('insertText', false, text);
                            if (!success) {
                                const selection = window.getSelection();
                                if (selection && selection.rangeCount > 0) {
                                    const range = selection.getRangeAt(0);
                                    range.deleteContents();
                                    const textNode = document.createTextNode(text);
                                    range.insertNode(textNode);
                                    // カーソルを新しいテキストの後に移動
                                    range.setStartAfter(textNode);
                                    range.setEndAfter(textNode);
                                    selection.removeAllRanges();
                                    selection.addRange(range);
                                }
                            }
                        }
                    }
                });

                // キーボードイベント（Tab、Backspace）
                editor.addEventListener('keydown', (e) => {
                    if (e.key === 'Tab') {
                        e.preventDefault();
                        if (e.shiftKey) {
                            // Shift+Tab: アウトデント
                            document.execCommand('outdent', false, null);
                        } else {
                            // Tab: インデント
                            document.execCommand('indent', false, null);
                        }
                    } else if (e.key === 'Backspace') {
                        // リスト項目の先頭でBackspaceが押された場合の処理
                        const selection = window.getSelection();
                        if (selection && selection.rangeCount > 0) {
                            const range = selection.getRangeAt(0);
                            const container = range.startContainer;

                            // カーソルが行頭にある場合
                            if (range.startOffset === 0) {
                                // 親要素がリスト項目かチェック
                                let listItem = container.nodeType === Node.TEXT_NODE
                                    ? container.parentElement
                                    : container;

                                while (listItem && listItem !== editor &&
                                       listItem.tagName !== 'LI') {
                                    listItem = listItem.parentElement;
                                }

                                if (listItem && listItem.tagName === 'LI') {
                                    // リスト項目の場合、デフォルト動作を防いで
                                    // アウトデントコマンドを実行
                                    e.preventDefault();
                                    document.execCommand('outdent', false, null);
                                }
                            }
                        }
                    }
                });

                todoContent.appendChild(toolbar);
                todoContent.appendChild(editor);

                todoItem.appendChild(todoHeader);
                todoItem.appendChild(todoContent);
                container.appendChild(todoItem);
            });
        }

        // 拡張機能からのメッセージを受信
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'fileSelected':
                    currentFilePath = message.filePath;
                    document.getElementById('filePath').textContent = currentFilePath;
                    break;
                case 'todosLoaded':
                    todos = message.todos;
                    renderTodos();
                    break;
            }
        });

        // 初期レンダリング
        renderTodos();

        // WebViewの準備が完了したことを通知
        vscode.postMessage({ type: 'ready' });
    </script>
</body>
</html>`;
    }
}
