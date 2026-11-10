import { Runtime, createServer } from '../server.js';

/** Legacy Jest fixtures connect over MCP protocol to the real SDK2 runtime. */
export class AbapAdtServer {
  readonly runtime: Runtime;
  private readonly server;
  constructor() {
    this.runtime = new Runtime();
    this.server = createServer(this.runtime);
  }
  connect(transport: unknown) { return this.server.connect(transport as Parameters<typeof this.server.connect>[0]); }
  async close() {
    await this.runtime.close();
    await this.server.close();
  }
}
