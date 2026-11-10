import { join } from 'node:path';
import { startApiServer, type ApiServer, type ApiServerOptions } from '../src/api/server.js';
import { setup } from './plugin-fixtures.js';

export async function bootApi(
  opts: { host?: string; server?: Partial<Omit<ApiServerOptions, 'loader' | 'log'>> } & Partial<
    Omit<ApiServerOptions, 'loader' | 'log'>
  > = {},
) {
  const { server: serverOpts, ...rest } = opts;
  const env = setup();
  env.copyHello();
  const loader = env.mk();
  await loader.loadAll();
  const server: ApiServer = await startApiServer({
    loader,
    log: env.log,
    tokenFile: join(env.home, 'run', 'token'),
    ...rest,
    ...serverOpts,
    port: 0,
  });
  return {
    env,
    loader,
    server,
    get: (path: string, headers: Record<string, string> = {}) => fetch(server.url + path, { headers }),
    post: (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(server.url + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
    auth: { authorization: `Bearer ${server.token}` },
    async close() {
      await server.close();
      env.cleanup();
    },
  };
}
