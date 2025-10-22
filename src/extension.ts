import * as vscode from 'vscode';
import { MemoViewProvider } from './memoViewProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('VSC Memo extension is now active');

    // WebView プロバイダーを登録
    const provider = new MemoViewProvider(context.extensionUri, context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(MemoViewProvider.viewType, provider)
    );
}

export function deactivate() {}
