/**
 * Termos de uso e Política de privacidade (ADR-0039). O mesmo texto existe na landing (site/termos.html e
 * site/privacidade.html): ao mudar aqui, mude lá e atualize LEGAL_VERSION (quem já aceitou não precisa aceitar de
 * novo; isso fica para uma mudança essencial, decidida à mão).
 */
import type { ReactNode } from 'react';

export const LEGAL_VERSION = '4 de novembro de 2026';
export const PROJECT_CONTACT = 'https://github.com/estopassoli/opencord/issues';

export interface LegalProps {
  /** nome da instância (INSTANCE_NAME) */
  instanceName: string;
  /** contato para dados pessoais definido pelo operador no painel; null = só o canal do projeto */
  contact: string | null;
}

function Contact({ contact }: { contact: string | null }) {
  if (!contact)
    return (
      <>
        pelo canal do projeto em <code>{PROJECT_CONTACT}</code>
      </>
    );
  const link = contact.includes('@') && !contact.includes('/') ? `mailto:${contact}` : contact;
  return (
    <>
      por <a href={link}>{contact}</a>
    </>
  );
}

const Dl = ({ items }: { items: [string, ReactNode][] }) => (
  <dl className="legal-dl">
    {items.map(([k, v]) => (
      <div key={k}>
        <dt>{k}</dt>
        <dd>{v}</dd>
      </div>
    ))}
  </dl>
);

export function PrivacyPolicy({ instanceName, contact }: LegalProps) {
  return (
    <article className="legal">
      <p className="legal-meta">Versão de {LEGAL_VERSION}</p>
      <p>
        Esta política explica quais dados o <strong>{instanceName}</strong> guarda sobre você, para quê, por quanto
        tempo e como exercer seus direitos, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018) e o Marco Civil
        da Internet (Lei 12.965/2014). O OpenCord é um software de código aberto; cada instância tem um operador
        próprio. O responsável pelos seus dados nesta instância é quem a opera, e o contato para assuntos de privacidade
        é <Contact contact={contact} />.
      </p>

      <h3>O que guardamos</h3>
      <Dl
        items={[
          [
            'Conta',
            'Apelido, nome de usuário, e-mail (opcional), foto de perfil e a senha, que fica só como hash (Argon2id), nunca em claro. Quem entra só com apelido não tem e-mail nem senha.',
          ],
          [
            'Sessões',
            'A cada entrada: endereço IP, navegador ou sistema (user agent), identificador do app no aparelho e, no app para computador, uma impressão digital do aparelho (hash dos endereços de rede). Servem para manter você conectado, limitar abusos e aplicar bloqueios de dispositivo.',
          ],
          [
            'Conteúdo',
            'Mensagens, arquivos, reações, enquetes, quadros, eventos, efeitos sonoros e configurações. Mensagens diretas e de grupo ficam no servidor como as de canal.',
          ],
          [
            'Voz, câmera e tela',
            'Passam pelo servidor de mídia e não são gravadas, a menos que alguém da chamada inicie uma gravação: todo mundo vê o aviso "Gravando", e o arquivo fica disponível por 24 horas a quem pode ver o canal.',
          ],
          [
            'Presença',
            'Se você está online e, se você ligar essa opção, o jogo que está rodando. Nada disso é guardado além do momento.',
          ],
          [
            'Auditoria',
            'Ações de administração e moderação (quem expulsou, baniu, mudou cargos), com data, para os moderadores do servidor e para o operador.',
          ],
        ]}
      />

      <h3>Para quê e com qual base legal</h3>
      <ul>
        <li>Prestar o serviço que você pediu: conversar, chamar, transmitir (execução de contrato, art. 7, V).</li>
        <li>
          Segurança e prevenção a abusos: limites por IP, bloqueio de dispositivo, auditoria (legítimo interesse, art.
          7, IX).
        </li>
        <li>Guardar registros de acesso pelo prazo do Marco Civil (obrigação legal, art. 7, II).</li>
        <li>E-mail opcional e exibição do jogo em execução: só com o seu consentimento (art. 7, I), revogável.</li>
      </ul>

      <h3>Moderação automática por inteligência artificial</h3>
      <p>
        Quando o operador liga a moderação automática, cada mensagem e arquivo é analisado antes de ser publicado por um
        modelo da Anthropic (Claude), processado nos Estados Unidos. Enviamos o texto, o seu apelido, as últimas
        mensagens do canal (suas e de outras pessoas, para contexto), as regras do servidor, as imagens e quadros
        extraídos dos vídeos. Essa é uma transferência internacional de dados (art. 33), feita sob os termos comerciais
        da Anthropic, que não usa o conteúdo enviado pela API para treinar modelos. O que a IA retém por dúvida fica
        visível aos moderadores do servidor até a decisão. Em mensagens diretas, quando o operador liga a moderação
        delas, nada fica retido por dúvida: só o grave (menores, nudez, violência, exposição de dados) é bloqueado, e o
        registro do bloqueio fica visível aos administradores da instância. Conteúdo grave pode suspender a conta e
        bloquear o aparelho automaticamente, com registro para revisão.
      </p>

      <h3>Com quem compartilhamos</h3>
      <p>
        Ninguém vende nem cede seus dados. Têm acesso técnico: os provedores de hospedagem e armazenamento usados pelo
        operador; a Anthropic, só para a moderação descrita acima; o YouTube, quando você usa "Assistir juntos" (o
        player é do próprio YouTube); o Resend, que entrega os e-mails da conta (códigos de confirmação e de acesso e
        avisos de login), só com o seu e-mail e o texto da mensagem; o KLIPY, quando você abre o seletor de GIFs (a
        busca e as imagens vêm direto dele para o seu app, com um identificador anônimo); o Slack, quando o dono de um
        servidor liga a ponte; e os bots que você ou o servidor adicionam, que recebem o que acontece nos servidores
        onde estão, segundo as permissões dadas a eles.
      </p>

      <h3>Criptografia</h3>
      <p>
        Toda a comunicação é criptografada em trânsito (HTTPS, WSS e DTLS-SRTP para a mídia). A criptografia{' '}
        <strong>não é de ponta a ponta</strong>: o servidor processa mensagens e mídia para entregá-las, moderá-las e
        guardá-las, e quem administra a infraestrutura tem acesso técnico ao conteúdo armazenado. Senhas nunca ficam em
        claro.
      </p>

      <h3>Por quanto tempo</h3>
      <Dl
        items={[
          ['Conta e conteúdo', 'Até você excluir a conta ou apagar o conteúdo.'],
          ['Sessões encerradas (IP, aparelho)', '180 dias, os 6 meses do Marco Civil (art. 15).'],
          ['Auditoria', '12 meses.'],
          ['Casos de moderação já decididos', '12 meses; os pendentes, até a decisão.'],
          ['Bloqueios de dispositivo', '12 meses.'],
          ['Gravações de chamada', '24 horas.'],
          ['Arquivos enviados sem mensagem', '24 horas.'],
          ['Cópias de segurança', 'Podem conter dados já apagados por um período adicional, até a rotação.'],
        ]}
      />

      <h3>Seus direitos (art. 18)</h3>
      <ul>
        <li>
          <strong>Acessar e levar</strong>: em Configurações → Conta → Privacidade e dados, "Baixar meus dados" gera um
          arquivo JSON com tudo o que guardamos sobre você.
        </li>
        <li>
          <strong>Corrigir</strong>: apelido, e-mail e foto você muda no próprio app.
        </li>
        <li>
          <strong>Excluir</strong>: "Excluir conta" apaga na hora sessões, arquivos enviados, foto, amizades, bloqueios,
          configurações, reações, votos, convites, casos de moderação e bots seus. Suas mensagens continuam nas
          conversas dos outros, assinadas "Usuário removido", porque fazem parte do histórico deles. Servidores que você
          possui passam ao membro mais antigo; sem outro membro, são excluídos.
        </li>
        <li>
          <strong>Revogar consentimento e se opor</strong>: tire o e-mail, desligue a exibição do jogo, ou fale com o
          operador.
        </li>
        <li>
          Para qualquer pedido, incluindo informação sobre com quem compartilhamos, fale <Contact contact={contact} />.
          Respondemos em até 15 dias. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).
        </li>
      </ul>

      <h3>Crianças e adolescentes</h3>
      <p>
        O serviço é para quem tem <strong>13 anos ou mais</strong>, e isso é declarado no cadastro. Não tratamos, de
        propósito, dados de menores de 13 anos; se um responsável souber de um cadastro assim, pode pedir a exclusão
        pelo contato acima. Menores de 18 anos usam o serviço com ciência dos responsáveis.
      </p>

      <h3>Segurança</h3>
      <p>
        Senhas com Argon2id, tokens de sessão rotativos e revogáveis, limites de tentativas, permissões por servidor e
        canal verificadas no servidor, mínimo de privilégios na infraestrutura. Incidentes que possam causar risco a
        você são comunicados a você e à ANPD, conforme o art. 48.
      </p>

      <h3>O que fica no seu aparelho</h3>
      <p>
        O app guarda localmente os tokens da sessão, suas preferências e, no computador, os clipes que você salva. Não
        há cookies de rastreamento nem publicidade.
      </p>

      <h3>Mudanças</h3>
      <p>
        Se esta política mudar em algo essencial, avisaremos no app e pediremos um novo aceite. A versão vigente é a
        indicada no topo.
      </p>
    </article>
  );
}

export function TermsOfUse({ instanceName, contact }: LegalProps) {
  return (
    <article className="legal">
      <p className="legal-meta">Versão de {LEGAL_VERSION}</p>
      <p>
        Estes termos valem entre você e quem opera o <strong>{instanceName}</strong>, uma instância do OpenCord, um
        software de código aberto (licença AGPL-3.0) para conversar por texto, voz e vídeo e transmitir a tela. Ao criar
        um apelido ou uma conta, você concorda com eles e com a Política de privacidade.
      </p>

      <h3>1. Idade</h3>
      <p>
        É preciso ter 13 anos ou mais. Menores de 18 anos usam o serviço com ciência dos responsáveis, que respondem
        pelo uso.
      </p>

      <h3>2. Sua identidade</h3>
      <ul>
        <li>Cada identidade é de uma pessoa só; não ceda nem venda a sua.</li>
        <li>
          Quem entra só com apelido fica preso ao aparelho; ao sair, o apelido pode ser perdido. Crie uma conta para
          manter.
        </li>
        <li>A senha é sua responsabilidade. Avise o operador se desconfiar de acesso indevido.</li>
        <li>Não finja ser outra pessoa, marca ou organização.</li>
      </ul>

      <h3>3. O que não pode</h3>
      <ul>
        <li>
          Conteúdo ilegal, inclusive qualquer forma de exploração sexual de crianças e adolescentes: tolerância zero,
          com comunicação às autoridades.
        </li>
        <li>
          Ameaças, assédio, perseguição, discriminação por qualquer motivo, incitação à violência, violência gráfica
          gratuita.
        </li>
        <li>Expor dados pessoais de terceiros sem autorização.</li>
        <li>Golpes, malware, spam, links enganosos, uso automatizado fora das APIs de bots.</li>
        <li>Violar direitos autorais ao transmitir ou enviar conteúdo de terceiros.</li>
        <li>Burlar bloqueios, suspensões ou a moderação, ou explorar falhas do serviço (reporte-as).</li>
      </ul>

      <h3>4. Moderação</h3>
      <p>
        Quando ligada, uma moderação automática por inteligência artificial avalia mensagens e arquivos antes de serem
        publicados e pode liberar, reter para revisão humana ou bloquear. Moderadores dos servidores e o operador podem
        remover conteúdo, aplicar castigo, expulsar, banir, suspender a conta e bloquear o aparelho. Cada servidor pode
        ter regras além destas. Para contestar uma decisão, fale <Contact contact={contact} />.
      </p>

      <h3>5. Servidores</h3>
      <p>
        Quem cria um servidor administra cargos, canais, convites e moderação dele, e responde pelas regras que define.
        O operador só intervém por violação destes termos, por ordem legal ou para manter o serviço funcionando. O
        servidor oficial da instância é aberto a todo mundo.
      </p>

      <h3>6. Seu conteúdo</h3>
      <p>
        O que você publica continua seu. Você dá ao operador uma licença não exclusiva, gratuita e limitada para
        armazenar, transmitir e exibir esse conteúdo às pessoas a quem você o endereça, e para moderá-lo. Ao transmitir
        a tela ou iniciar uma gravação, você responde pelo que aparece e pelo som; gravações avisam todos na chamada.
      </p>

      <h3>7. Bots e integrações</h3>
      <p>
        Quem adiciona um bot ou liga uma integração responde pelo que ele faz no servidor. Bots oficiais podem mudar ou
        ser retirados a qualquer momento.
      </p>

      <h3>8. Disponibilidade</h3>
      <p>
        O serviço é gratuito e oferecido "como está", sem garantia de funcionamento ininterrupto. Pode haver manutenção,
        limites de uso (tamanho de arquivo, taxa de requisições) e mudanças de recursos. Faça cópia do que for
        importante.
      </p>

      <h3>9. Encerramento</h3>
      <p>
        Você pode excluir a conta a qualquer momento em Configurações → Conta. O operador pode suspender ou encerrar
        identidades que violem estes termos. O destino dos dados está na Política de privacidade.
      </p>

      <h3>10. Responsabilidade</h3>
      <p>
        O operador não é autor do que as pessoas publicam e responde por conteúdo de terceiros nos termos do Marco Civil
        da Internet e da legislação brasileira. Nada aqui limita direitos que a lei garante a você, inclusive como
        consumidor.
      </p>

      <h3>11. Lei e foro</h3>
      <p>
        Aplica-se a lei brasileira. Conflitos são resolvidos no foro do seu domicílio, quando você for consumidor, ou no
        do operador nos demais casos.
      </p>

      <h3>12. Mudanças e contato</h3>
      <p>
        Mudanças essenciais são avisadas no app, com novo aceite. Dúvidas e pedidos: <Contact contact={contact} />.
      </p>
    </article>
  );
}
