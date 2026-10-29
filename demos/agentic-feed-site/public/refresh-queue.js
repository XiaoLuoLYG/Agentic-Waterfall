export class RefreshQueue {
  constructor(run, onError = () => {}) { this.run = run; this.onError = onError; this.commands = []; this.feedback = false; this.prefetch = false; this.running = false; this.active = 0; this.stopped = false; }
  retry(delay, ready) { this.cancelRetry(); this.retryTimer = setTimeout(() => { this.retryTimer = null; if (this.stopped) return; if (ready()) this.fill(); else this.retry(delay, ready); }, delay); }
  cancelRetry() { clearTimeout(this.retryTimer); this.retryTimer = null; }
  command(text, id = null) { if (text) this.commands.push({ text, id }); this.pump(); }
  changed() { this.feedback = true; this.pump(); }
  fill() { this.prefetch = true; this.pump(); }
  stop() { this.cancelRetry(); this.stopped = true; this.commands.length = 0; this.feedback = false; this.prefetch = false; }
  async pump() {
    if (this.stopped || (this.running && !this.commands.length && !this.feedback)) return;
    let task;
    if (this.commands.length) { const next = this.commands.shift(); task = { reason: 'command', command: next.text, ...(next.id ? { commandId: next.id } : {}) }; this.feedback = false; this.prefetch = false; }
    else if (this.feedback) { task = { reason: 'feedback', command: '' }; this.feedback = false; this.prefetch = false; }
    else if (this.prefetch) { task = { reason: 'prefetch', command: '' }; this.prefetch = false; }
    else return;
    this.active++; this.running = true;
    try { await this.run(task); } catch (error) { this.onError(error); }
    finally { this.active--; this.running = this.active > 0; if (!this.stopped) this.pump(); }
  }
}
