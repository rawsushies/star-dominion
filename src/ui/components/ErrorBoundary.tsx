// Crash containment. A failure while drawing one window shows a short message in that window
// (with a retry) instead of blanking the whole game; a failure of the whole interface offers to
// save the reign to a file and reload. Errors are kept so a player can copy them into a report.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useUI } from '../store';
import { serialize } from '../../sim/save';
import { APP_VERSION } from '../../version';

export const crashLog: { at: string; where: string; message: string }[] = [];

function remember(where: string, error: unknown, info?: ErrorInfo) {
  const message = `${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}${info?.componentStack ? `\n${info.componentStack.split('\n').slice(0, 6).join('\n')}` : ''}`;
  crashLog.push({ at: new Date().toISOString(), where, message });
  if (crashLog.length > 20) crashLog.shift();
  console.error(`[Star Dominion ${APP_VERSION}] ${where} failed:`, error);
}

/** Download the running reign as a save file (works even when the interface is broken). */
export function rescueSave() {
  const g = useUI.getState().game;
  if (!g) return false;
  try {
    const blob = new Blob([serialize(g)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `star-dominion-rescue-${g.tick}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return true;
  } catch { return false; }
}

interface Props { where: string; children: ReactNode; /** whole-app boundary: offers rescue and reload */ root?: boolean }
interface State { error: unknown }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: unknown): State { return { error }; }
  componentDidCatch(error: unknown, info: ErrorInfo) { remember(this.props.where, error, info); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const msg = error instanceof Error ? error.message : String(error);
    // a code file that could not be fetched: offline before it was cached, or replaced by an update
    const fetchFailed = /dynamically imported module|Importing a module script failed|Loading chunk|Failed to fetch/i.test(msg);
    if (fetchFailed && !this.props.root) {
      return (
        <div className="crash-note" role="alert">
          <b>This part of the game could not be downloaded.</b>
          <p className="hint">You may be offline, or a new version of the game was released. Your reign is intact: save it from the Chancery (Esc), then reload the page.</p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn small" onClick={() => { rescueSave(); }}>Save reign to a file</button>
            <button className="btn small" onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      );
    }
    if (!this.props.root) {
      return (
        <div className="crash-note" role="alert">
          <b>This window hit a problem and was closed safely.</b>
          <p className="hint">The rest of the game is unaffected and your reign is intact. Details: {msg}</p>
          <button className="btn small" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    }
    return (
      <div className="crash-screen" role="alert">
        <h1 className="serif">The interface stopped</h1>
        <p>Something went wrong while drawing the game. Your reign is still in memory: save it to a file first, then reload. You can load that file from the Chancery (Import save file).</p>
        <p className="hint">Version {APP_VERSION}. Details: {msg}</p>
        <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
          <button className="btn primary" onClick={() => rescueSave()}>Save reign to a file</button>
          <button className="btn" onClick={() => this.setState({ error: null })}>Try to continue</button>
          <button className="btn" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
