import { join } from 'node:path';
import { startApiServer, type ApiServer, type ApiServerOptions } from '../src/api/server.js';
import { setup } from './plugin-fixtures.js';

export async function bootApi(
  opts: { host?: string } & Partial<Omit<ApiServerOptions, 'loader' | 'log'>> = {},
) {
  const env = setup();
  env.copyHello();
  const loader = env.mk();
  await loader.loadAll();
  const server: ApiServer = await startApiServer({
    loader,
    log: env.log,
    tokenFile: join(env.home, 'run', 'token'),
    ...opts,
    port: 0,
  });
  return {
    env,
    loader,
    server,
    get: (path: string, headers: Record<string, string> = {}) => fetch(server.url + path, { headers }),
    auth: { authorization: `Bearer ${server.token}` },
    async close() {
      await server.close();
      env.cleanup();
    },
  };
}
