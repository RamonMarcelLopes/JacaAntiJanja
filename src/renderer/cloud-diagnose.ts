/**
 * Explains why a Cloudflare room could not be reached. Three checks from this PC, in order:
 * 1. a WebSocket to the Worker (what a room uses): if it works the network is fine;
 * 2. a plain HTTPS request to the Worker (made by the main process): if only this works, something blocks WebSockets;
 * 3. neither: this PC cannot reach workers.dev at all.
 */
export async function diagnoseCloud(wsBase: string, subdomain: string): Promise<string> {
  if (await webSocketWorks(wsBase)) {
    return 'A conexão com a Cloudflare funciona neste PC, então o problema não é a sua rede. Provavelmente a sala não está aberta agora ou o código mudou: peça ao dono para criar a sala de novo e mandar o código atual.';
  }
  const reach = await window.jaca.workerReachable(subdomain);
  if (reach.ok) {
    return 'Este PC alcança a Cloudflare, mas a conexão da sala (WebSocket) está sendo bloqueada. Costuma ser a proteção web do antivírus, um firewall ou a rede. Tente outra rede (hotspot do celular) ou desative a proteção web do antivírus para o Jaca anti Janja.';
  }
  return `Este PC não consegue alcançar o servidor da Cloudflare (workers.dev). Confira a internet; se ela estiver ok, troque o DNS do Windows para 1.1.1.1 ou veja se a rede, o antivírus ou o firewall bloqueia o Jaca anti Janja. Detalhe técnico: ${reach.detail || 'sem detalhe'}.`;
}

/** Opens a WebSocket to a room id nobody created: a working Worker answers "room closed", which proves the whole path works. */
function webSocketWorks(wsBase: string): Promise<boolean> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 7000);
    try {
      ws = new WebSocket(`${wsBase}/ws/0000000000`);
    } catch {
      clearTimeout(timer);
      resolve(false);
      return;
    }
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', to: null, payload: { token: 0, name: 'teste', avatar: null } }));
    ws.onmessage = () => finish(true);
    ws.onerror = () => finish(false);
    ws.onclose = () => finish(false);
  });
}
