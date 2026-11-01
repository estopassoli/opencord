/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_OPENCORD_SERVER_URL?: string;
  /** layout inicial da interface: 'vidro' (redesign em teste) ou 'classico' (padrão) */
  readonly VITE_OPENCORD_LAYOUT?: string;
  /** '1': ignora o endereço de servidor salvo e usa VITE_OPENCORD_SERVER_URL (teste contra remoto) */
  readonly VITE_OPENCORD_FORCE_SERVER?: string;
}
