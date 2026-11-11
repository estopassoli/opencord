// Faixa do controle remoto (ADR-0026): o nome vem pela URL e entra por textContent; "Parar" avisa a janela principal.
import { emit } from '@tauri-apps/api/event';

document.getElementById('who')!.textContent = new URLSearchParams(location.search).get('n') ?? '';
document.getElementById('stop')!.addEventListener('click', () => void emit('oc:banner-stop'));
