# Fogos de artifício

Um webapp de evento: quem está na plateia abre `/` no celular, escolhe **um
formato e uma cor**, e o fogo estoura em tempo real no telão em `/screen`.

Não há nome, texto nem qualquer campo livre. O backend só aceita ids de um
catálogo fechado, então nada que um participante envia pode virar conteúdo
arbitrário na projeção.

## Arquitetura

```
  📱 Participante                    ☁️  AWS                         📺 Telão
  ─────────────                      ──────                         ────────

  GET /                        ┌──────────────────────┐
  escolhe formato + cor   ───► │  Amplify Hosting     │
                               │  (CloudFront + SSR)  │
  POST /api/fireworks     ───► │  Next.js Route       │
   { animation, color }        │  Handler (Lambda)    │
                               │   • valida o enum    │
                               │   • throttle por IP  │
                               └──────────┬───────────┘
                                          │ POST /event  (SigV4 / AWS_IAM)
                                          ▼
                               ┌──────────────────────┐
                               │  AppSync Events API  │
                               │  canal /default/show │
                               └──────────┬───────────┘
                                          │ WebSocket subscribe (API key)
                                          ▼
                               GET /screen ──► <canvas> renderiza
```

| Peça | Serviço | Papel |
| --- | --- | --- |
| CI/CD + hospedagem | **AWS Amplify Hosting** | Conecta no GitHub, builda a cada `push`, serve o Next.js com SSR atrás do CloudFront |
| Tempo real | **AWS AppSync Events** | Pub/sub WebSocket gerenciado, sem tabela de conexões nem Lambda de broadcast |

### Por que a autorização é dividida

```
conectar  → API_KEY   (o telão, num navegador)
assinar   → API_KEY   (idem)
publicar  → AWS_IAM   (só o backend, assinando com SigV4)
```

A chave que vai no bundle do telão é pública por natureza — e inútil para
injetar fogos, porque publicar exige SigV4. Quem publica é a **role de compute
SSR** do Amplify, cujas credenciais temporárias ficam disponíveis dentro da
Lambda sem nenhum segredo em variável de ambiente.

## Rodando local (sem AWS)

```bash
npm install
npm run dev
```

Sem as variáveis de ambiente do AppSync o app usa um **barramento em memória**:
o Route Handler publica nele e o telão consome por SSE em `/api/stream`. Serve
para desenvolver e ensaiar o visual sem provisionar nada.

Abra `http://localhost:3000/screen` numa janela e `http://localhost:3000` em
outra. `GET /api/health` diz qual transporte está ativo.

> Esse modo só funciona porque `next dev` é um processo único. Em produção, com
> várias Lambdas, ele não entregaria eventos entre instâncias — que é
> exatamente o motivo de existir o AppSync Events.

## Deploy

### 1. Provisionar o canal

```bash
cd infra
npm install
npx cdk bootstrap        # só na primeira vez, por conta/região
npm run deploy
```

Guarde os outputs:

| Output | Vai para |
| --- | --- |
| `EventsHttpDomain` | `EVENTS_HTTP_DOMAIN` e `NEXT_PUBLIC_EVENTS_HTTP_DOMAIN` |
| `EventsRealtimeDomain` | `NEXT_PUBLIC_EVENTS_REALTIME_DOMAIN` |
| `EventsApiKey` | `NEXT_PUBLIC_EVENTS_API_KEY` |
| `EventsChannel` | `EVENTS_CHANNEL` e `NEXT_PUBLIC_EVENTS_CHANNEL` |
| `AmplifyComputeRoleArn` | Compute role do app no Amplify (passo 3) |
| `PublishPolicyArn` | Anexe ao seu usuário IAM para publicar de máquina local |

### 2. Conectar o Amplify ao GitHub

1. Suba este repositório para o GitHub.
2. No console do Amplify → **Create new app** → **GitHub**, autorize e escolha o
   repositório e a branch.
3. O Amplify detecta o Next.js e usa o `amplify.yml` do repo.
4. Em **Environment variables**, cole as seis variáveis do `.env.example`
   preenchidas com os outputs acima.

> As `NEXT_PUBLIC_*` são embutidas no bundle **em tempo de build**. Se você
> alterá-las depois, é preciso redeployar a branch — não basta salvar.

A partir daí, cada `push` na branch dispara build e deploy. Pull requests podem
ganhar preview próprio em **Previews**.

### 3. Dar permissão de publicação ao backend

O app roda em SSR, então precisa das credenciais para assinar o publish:

1. Console do Amplify → seu app → **App settings** → **IAM roles**.
2. Em **Compute role**, selecione a role do output `AmplifyComputeRoleArn`.
3. Salve. Não precisa redeployar — a mudança vale na hora.

Confira com `GET /sua-url/api/health`: deve responder
`{"transport":"appsync-events"}`.

## Segurança e abuso

- **Payload fechado.** `parseFireworkRequest` só aceita ids do catálogo em
  `lib/fireworks.ts`. Nada de texto livre, nada de PII.
- **Throttle por IP** no Route Handler: rajada de 3, depois um fogo a cada 3s.
  É cortesia, não defesa — cada instância da Lambda tem seu próprio balde.
- **Defesa real contra abuso:** uma regra rate-based do **AWS WAF** associada ao
  app no Amplify (**App settings → Firewall**). Recomendado se o link for
  público ou o evento for grande.
- **Rotação da chave.** A API key do telão vale 365 dias a partir do último
  `cdk deploy`. Para rotacionar, redeploy da stack e atualize a variável no
  Amplify (com rebuild).

## Custo

Ordem de grandeza para um evento de algumas horas com centenas de
participantes: **poucos dólares**. O Amplify cobra por minuto de build, por GB
servido e pela compute SSR; o AppSync Events cobra por operação e por minuto de
conexão — e o telão é uma conexão só. Confirme os números atuais nas páginas de
pricing antes de um evento grande.

## Estrutura

```
app/
  page.tsx                  seletor (formato + cor), mobile-first
  screen/page.tsx           telão: canvas, QR de entrada, status da conexão
  api/fireworks/route.ts    valida, limita e publica
  api/stream/route.ts       SSE do modo local
  api/health/route.ts       qual transporte está ativo
components/
  FireworkGlyph.tsx         ícone SVG de cada formato, tirado do mesmo contorno
lib/
  fireworks.ts              catálogo + validação (compartilhado cliente/servidor)
  engine.ts                 motor de partículas + receita de cada explosão
  shapes.ts                 contornos paramétricos (estrela, coração, espiral)
  event-client.ts           assinatura no navegador (WebSocket ou SSE)
  appsync.ts                publish assinado com SigV4
  local-bus.ts              barramento em memória do modo local
  rate-limit.ts             throttle por IP
infra/                      CDK: Event API, namespace, chave, roles
amplify.yml                 buildspec do Amplify Hosting
```

## Os fogos

Nove formatos, todos definidos como receitas declarativas em `SHELLS`
(`lib/engine.ts`). Ajustar um fogo é mexer em números — contagem, velocidade,
vida, gravidade, arrasto — e não em código de desenho.

| Formato | O que faz |
| --- | --- |
| Peônia | Esfera cheia com núcleo lento e mais claro, que dá volume |
| Crisântemo | Casca oca com arrasto baixo: rastros longos que esfriam para brasa |
| Salgueiro | Gravidade alta e arrasto alto — a cortina cai quase reta e sai da tela |
| Palmeira | Oito jatos grossos com velocidade crescente ao longo do traço |
| Anel | Círculo achatado no eixo Y, como um anel visto de viés |
| Estrela | Contorno de cinco pontas, expandido em escala única |
| Coração | Curva paramétrica clássica, ponta para baixo |
| Espiral | Três braços onde o raio cresce junto com o ângulo |
| Estalo | Abre discreto e, 200–500ms depois, cada estrela se parte em faíscas |

Três mecanismos sustentam isso:

- **Camadas.** Quase todo fogo bonito é uma casca externa somada a um núcleo
  mais lento e mais claro. Cada camada tem física própria.
- **Ignição secundária.** Uma partícula pode se partir em faíscas depois de um
  tempo de voo. É o que faz o estalo ser um estalo: o brilho que importa não
  nasce na explosão, nasce depois dela.
- **Figuras.** Estrela, coração e espiral vêm de contornos em `lib/shapes.ts`,
  reamostrados por perímetro para as partículas não se acumularem nos vértices.
  O ponto do contorno *é* o vetor de velocidade, multiplicado por uma escala
  única — por isso a figura expande sem se deformar. Gravidade baixa e arrasto
  alto seguram a forma legível por pouco mais de um segundo.

Os ícones do seletor desenham os mesmos contornos que o motor usa, então o
botão mostra literalmente o que vai aparecer no céu.

## Atalhos do telão

| Tecla | Ação |
| --- | --- |
| `F` | Tela cheia |
| `H` | Esconder/mostrar o overlay |

O telão também segura o *wake lock* enquanto a aba está visível, para o
projetor não dormir no meio do evento.
