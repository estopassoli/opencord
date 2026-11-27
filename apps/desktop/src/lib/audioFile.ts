/** baixa um arquivo de áudio do app: fetch; se o esquema file:// do app empacotado for recusado, XMLHttpRequest */
export async function fetchAudio(url: string): Promise<ArrayBuffer> {
  try {
    const r = await fetch(url);
    // file:// responde com status 0 quando dá certo
    if (!r.ok && r.status !== 0) throw new Error(`HTTP ${r.status}`);
    return await r.arrayBuffer();
  } catch (err) {
    if (typeof XMLHttpRequest === 'undefined') throw err;
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('GET', url);
      x.responseType = 'arraybuffer';
      x.onload = () =>
        x.response instanceof ArrayBuffer && x.response.byteLength > 0
          ? resolve(x.response)
          : reject(new Error(`XHR ${x.status}`));
      x.onerror = () => reject(err instanceof Error ? err : new Error(String(err)));
      x.send();
    });
  }
}
