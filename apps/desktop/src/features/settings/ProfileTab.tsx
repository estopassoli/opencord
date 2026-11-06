import { useData } from '../../store/data';
import { ProfileEditor } from './ProfileEditor';
import { Section } from './Section';

/** Perfil (ADR-0048): foto, banner, cores e bio com prévia ao vivo. */
export function ProfileTab() {
  const me = useData((s) => s.me);
  if (!me) return null;
  return (
    <Section title="Perfil" description="Como os outros veem você ao abrir o seu cartão de perfil.">
      <ProfileEditor me={me} />
    </Section>
  );
}
