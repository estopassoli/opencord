import { useData } from '../../store/data';
import { MyDataSection } from './MyDataSection';
import { ProfileEditor } from './ProfileEditor';
import { Section } from './Section';

/** Perfil (ADR-0048): foto, banner, cores e bio com prévia ao vivo; embaixo, o @, o e-mail e o apelido. */
export function ProfileTab() {
  const me = useData((s) => s.me);
  if (!me) return null;
  return (
    <>
      <Section title="Perfil" description="Como os outros veem você ao abrir o seu cartão de perfil.">
        <ProfileEditor me={me} />
      </Section>
      <MyDataSection me={me} />
    </>
  );
}
