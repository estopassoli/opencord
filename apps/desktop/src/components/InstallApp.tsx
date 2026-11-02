import { Button, Icon } from '@opencord/ui';
import { useInstall } from '../lib/pwa';
import { useUi } from '../store/ui';
import { Tooltip } from './Tooltip';

const IOS_HINT = 'No Safari, toque em Compartilhar e depois em "Adicionar à Tela de Início".';

/** Item do rail (navegador do celular): instala o app na tela inicial. */
export function InstallAppRailItem() {
  const kind = useInstall((s) => s.kind);
  if (kind === 'none') return null;
  const label = 'Instalar o OpenCord no celular';
  const onClick = () => {
    if (kind === 'ios') useUi.getState().toast('info', IOS_HINT);
    else void useInstall.getState().install();
  };
  return (
    <li className="rail-li">
      <span className="rail-pill" aria-hidden />
      <Tooltip label={label} side="right">
        <button className="rail-item rail-action install-rail-item" aria-label={label} onClick={onClick}>
          <Icon name="smartphone" />
        </button>
      </Tooltip>
    </li>
  );
}

/** Bloco das configurações (Sobre): botão de instalar ou a orientação do iOS. */
export function InstallAppBlock() {
  const kind = useInstall((s) => s.kind);
  if (kind === 'none') return null;
  return (
    <div className="install-block">
      <p className="muted">Instale na tela inicial: abre em tela cheia, como um app.</p>
      {kind === 'ios' ? (
        <p className="small">{IOS_HINT}</p>
      ) : (
        <Button icon="smartphone" variant="secondary" onClick={() => void useInstall.getState().install()}>
          Instalar o app
        </Button>
      )}
    </div>
  );
}
