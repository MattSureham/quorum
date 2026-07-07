export class CommandMailbox {
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;

  enqueue<T>(label: string, task: () => T | Promise<T>): Promise<T> {
    if (this.stopped) return Promise.reject(new Error(`mailbox stopped: ${label}`));

    const run = this.chain.then(task, task);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async drain(): Promise<void> {
    await this.chain;
  }

  stop(): void {
    this.stopped = true;
  }
}
