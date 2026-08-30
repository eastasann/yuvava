import * as vscode from 'vscode';

/**
 * SPEC §12.2: state display is minimal, and Navigator keeps out of sight when
 * it has nothing to say. The item is hidden while idle with no observations.
 */
export class NavigatorStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
    this.item.command = 'navigator.showLog';
  }

  setReviewing(): void {
    this.item.text = '$(eye) Navigator: reviewing';
    this.item.tooltip = 'Navigator is reviewing the current changes';
    this.item.show();
  }

  /** SPEC §10: the guidance command's only state display. */
  setLooking(): void {
    this.item.text = '$(search) Navigator: looking';
    this.item.tooltip = 'Navigator is working out where to look';
    this.item.show();
  }

  setObservations(count: number): void {
    if (count <= 0) {
      this.setIdle();
      return;
    }
    this.item.text = `$(warning) Navigator: ${count} observation${count === 1 ? '' : 's'}`;
    this.item.tooltip = 'Navigator observations are listed in the Problems panel';
    this.item.show();
  }

  setIdle(): void {
    this.item.text = 'Navigator: idle';
    this.item.tooltip = undefined;
    this.item.hide();
  }

  dispose(): void {
    this.item.dispose();
  }
}
