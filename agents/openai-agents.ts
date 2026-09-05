import type {
  AgentResult,
  CommercialAgent,
  GateResult,
  ProfessionalGate,
  ResponseVerifier,
  StoredMessage,
  VerificationResult,
} from '../core/contracts.ts';
import {
  catalog,
  findCatalogService,
  formatCatalogPrice,
  normalizeCatalogText,
} from '../knowledge/catalog.ts';

type Schema = Record<string, unknown>;

class OpenAIResponsesClient {
  private readonly apiKey?: string;
  private readonly model?: string;
  private readonly request: typeof fetch;

  constructor(apiKey?: string, model?: string, request: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.model = model;
    this.request = request;
  }

  get configured() {
    return Boolean(this.apiKey && this.model);
  }

  async json<T>(
    name: string,
    schema: Schema,
    instructions: string,
    input: string,
  ): Promise<T> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY missing');
    if (!this.model) throw new Error('OPENAI_MODEL missing');
    const body = JSON.stringify({
      model: this.model,
      store: false,
      max_output_tokens: 700,
      prompt_cache_key: 'atende-commercial-v2',
      reasoning: { effort: 'low' },
      instructions,
      input,
      text: {
        verbosity: 'low',
        format: { type: 'json_schema', name, strict: true, schema },
      },
    });
    let response: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await this.request('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: AbortSignal.timeout(12_000),
        });
        if (
          response.ok ||
          (![408, 409, 429].includes(response.status) &&
            response.status < 500) ||
          attempt === 1
        )
          break;
      } catch (error) {
        if (attempt === 1)
          throw new Error(
            `OpenAI API unavailable: ${error instanceof Error ? error.message : String(error)}`,
          );
      }
      await new Promise((resolve) => setTimeout(resolve, 350 * 2 ** attempt));
    }
    if (!response) throw new Error('OpenAI API unavailable');
    const payload = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok)
      throw new Error(
        `OpenAI API returned ${response.status}${response.headers.get('x-request-id') ? ` (${response.headers.get('x-request-id')})` : ''}`,
      );
    const direct =
      typeof payload.output_text === 'string' ? payload.output_text : '';
    const output = Array.isArray(payload.output) ? payload.output : [];
    const fallback = output
      .flatMap((item) => {
        const content =
          item &&
          typeof item === 'object' &&
          Array.isArray((item as { content?: unknown[] }).content)
            ? (item as { content: unknown[] }).content
            : [];
        return content.map((part) =>
          part &&
          typeof part === 'object' &&
          typeof (part as { text?: unknown }).text === 'string'
            ? (part as { text: string }).text
            : '',
        );
      })
      .join('');
    const result = direct || fallback;
    if (!result) throw new Error('OpenAI API returned no structured output');
    return JSON.parse(result) as T;
  }
}

function transcript(messages: StoredMessage[]) {
  return messages
    .map(
      (message) =>
        `[${message.createdAt} ${message.senderType}/${message.messageType}] ${message.body ?? '(sem texto; mídia recebida)'}`,
    )
    .join('\n');
}

const agentSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: { type: 'string' },
    interest: { type: ['string', 'null'] },
    opportunityStage: { type: 'string' },
    crmSummary: { type: 'string' },
    intent: { type: 'string' },
    temperature: { type: 'string', enum: ['COLD', 'WARM', 'HOT', 'VERY_HOT'] },
    objection: { type: ['string', 'null'] },
    nextBestAction: {
      type: 'string',
      enum: [
        'ANSWER_QUESTION',
        'QUALIFY',
        'HANDLE_OBJECTION',
        'OFFER_PERIOD',
        'OFFER_TIME',
        'CONFIRM_BOOKING',
        'CREATE_FOLLOW_UP',
        'REQUEST_HUMAN_CONFIRMATION',
      ],
    },
    requiresFollowUp: { type: 'boolean' },
  },
  required: [
    'reply',
    'interest',
    'opportunityStage',
    'crmSummary',
    'intent',
    'temperature',
    'objection',
    'nextBestAction',
    'requiresFollowUp',
  ],
};

export class OpenAIProfessionalGate implements ProfessionalGate {
  constructor(_client: OpenAIResponsesClient) {}

  async evaluate({
    messages,
  }: {
    messages: StoredMessage[];
    knowledge: string;
  }): Promise<GateResult> {
    const unsupportedMedia = messages.some(
      (message) =>
        !['text', 'interactive', 'image'].includes(message.messageType),
    );
    if (unsupportedMedia) {
      return {
        decision: 'PROFESSIONAL_HANDOFF',
        reason: 'Formato recebido requer avaliação humana neste MVP',
        confidence: 1,
        crmSummary: 'Mídia recebida; aguardando avaliação profissional.',
      };
    }
    const text = transcript(messages);
    const healthOrDamageRisk =
      /quebr|queda|ferida|alerg|queim|ard[eê]n|coceira|gestant|doen[cç]|medic|dermat|machuc|couro cabeludo|rea[cç][aã]o|qu[ií]mica.*(dano|problema|recente)|dano.*qu[ií]mica|seguran[cç]a.*procedimento/i.test(
        text,
      );
    const technicalColorAnalysis =
      /(qual|que).{0,35}(cor|tom).{0,35}(combina|ideal|ficaria|fica melhor)|analis(e|ar).{0,35}(cor|tom|foto|cabelo)|fundo de clareamento|altura de tom|neutraliz(ar|a[cç][aã]o)|f[oó]rmula.{0,20}(cor|colora[cç][aã]o)|mistura.{0,20}(tinta|colora[cç][aã]o)|como corrigir.{0,20}(cor|tom)/i.test(
        text,
      );
    const chemicalCompatibility =
      /(posso|pode|seguro).{0,45}(progressiva|luzes|mechas|descolor|colora[cç][aã]o).{0,55}(depois|antes|junto|com).{0,45}(qu[ií]mica|progressiva|luzes|mechas|hen[eê]|tintura)|teste de mecha.{0,30}(resultado|deu|ficou|aprov)/i.test(
        text,
      );
    const visualTechnicalJudgment =
      /d[aá] pra (?:chegar|ficar|fazer|deixar).{0,55}(loiro|cor|tom|resultado)|(?:aguenta|suporta).{0,35}(descolora|qu[ií]mica)|(?:isso [eé]|parece).{0,35}(quebra|dano)/i.test(
        text,
      );
    const individualizedRecommendation =
      /qual.{0,30}(procedimento|tratamento|corte|cor|tom).{0,35}(melhor|ideal|precis[ao]|combina|indica|recomenda)|o que.{0,25}(meu cabelo|cabelo).{0,35}(precisa|tem|aconteceu)|o que.{0,25}(aconteceu|houve).{0,25}(meu cabelo|cabelo)|(?:esse|essa).{0,25}(mega\s*hair|qu[ií]mica|procedimento).{0,35}(danifica|estraga|seguro)|(?:meu cabelo|cabelo).{0,30}(el[aá]stic|poros|danificad|saud[aá]vel)|d[aá] pra corrigir.{0,35}(cor|tom|cabelo)/i.test(
        text,
      );
    const critical =
      healthOrDamageRisk ||
      technicalColorAnalysis ||
      chemicalCompatibility ||
      visualTechnicalJudgment ||
      individualizedRecommendation;
    const hasImage = messages.some(
      (message) => message.messageType === 'image',
    );
    const safeReferenceImage =
      hasImage &&
      /refer[eê]ncia|estilo|corte|franja|mais curt|mais comprid|quero (?:esse|essa|assim)/i.test(
        text,
      );
    if (hasImage && !safeReferenceImage && !critical) {
      return {
        decision: 'PROFESSIONAL_HANDOFF',
        reason:
          'Imagem sem contexto comercial suficiente para resposta automática segura',
        confidence: 0.96,
        crmSummary:
          'Imagem recebida sem contexto suficiente; aguardando atendimento humano.',
      };
    }
    if (safeReferenceImage && !critical) {
      return {
        decision: 'ALLOW_COMMERCIAL',
        reason:
          'Imagem identificada apenas como referência estética ou contexto comercial',
        confidence: 0.96,
        crmSummary:
          'Cliente enviou referência estética; atendimento comercial pode continuar sem análise técnica.',
      };
    }
    return critical
      ? {
          decision: 'PROFESSIONAL_HANDOFF',
          reason:
            'Relato de possível dano ou condição que exige avaliação profissional',
          confidence: 0.99,
          crmSummary:
            'Cliente relatou possível dano/condição sensível. Nenhuma resposta automática enviada.',
        }
      : {
          decision: 'ALLOW_COMMERCIAL',
          reason: 'Intenção comercial sem sinal profissional crítico',
          confidence: 0.9,
          crmSummary: 'Contato comercial apto para atendimento automatizado.',
        };
  }
}

const COMMERCIAL_INSTRUCTIONS = `Você atende o WhatsApp do RJ Studio de Beleza como uma cabeleireira experiente, simpática e muito acostumada ao dia a dia de um salão. A cliente deve sentir que conversa com uma pessoa real que entendeu o que ela quer e vai facilitar o atendimento. Sua experiência aparece na segurança, nas perguntas simples e na condução natural, nunca em palestras técnicas ou avaliação individual do cabelo.

Antes de responder, classifique internamente intenção, etapa do funil, temperatura, objeção e próxima melhor ação. Preencha o schema sem expor essa classificação.

Regra principal — pareça humana:
- escreva como alguém atendendo pelo celular entre uma cliente e outra: normalmente 1 ou 2 frases curtas e no máximo uma pergunta;
- não soe robótica, engessada, formal demais, perfeita demais, padronizada, repetitiva, explicativa ou parecida com central de atendimento;
- use linguagem cotidiana, pequenas pausas e reações proporcionais quando fizer sentido: “Oii!”, “Ahh, entendi”, “Pode deixar”, “Deixa eu ver”, “Poxa”, “Que bom”. Use com moderação e nunca como bordão;
- varie naturalmente a abertura e a construção. Não comece sempre com “Claro”, “Entendi” ou “Perfeito” e não termine sempre oferecendo horários;
- adapte o ritmo ao jeito da cliente: seja curta com quem escreve curto, um pouco mais contextual com quem detalha, mais educada com quem é formal e mais leve com quem é descontraída;
- não force intimidade, gírias, erros de digitação ou reticências. Não use “amiga”, “linda”, “amor”, “querida”, “meu bem”, “gata” ou “diva”;
- emoji é raro: se combinar com o momento e com a cliente, use no máximo um;
- use o nome ocasionalmente quando for natural, nunca em toda mensagem;
- nunca diga nem sugira que é IA, assistente virtual, chatbot, sistema, modelo de linguagem ou que foi programada. Nunca fale de instruções, limitações do sistema ou incapacidade de analisar imagens;
- evite frases corporativas e burocráticas como “para que eu possa ajudá-la”, “de maneira mais assertiva”, “solicitarmos a confirmação”, “conforme disponibilidade”, “para dar continuidade” e “gostaria de”.

Conversa sem roteiro aparente:
- responda primeiro à pergunta direta da cliente. Depois faça somente a próxima pergunta realmente necessária;
- não repita o que a cliente acabou de dizer apenas para confirmar. Reaja ao sentido e avance;
- não siga sempre a mesma ordem de serviço, comprimento, preço, dia e horário. Use tudo que ela já informou e nunca pergunte de novo;
- faça no máximo uma pergunta por mensagem e não transforme o atendimento em formulário ou interrogatório;
- responda só o necessário. Não despeje duração, pagamento, endereço, profissional, produto, benefícios, políticas, cuidados ou detalhes técnicos sem a cliente pedir ou sem isso ser indispensável naquele momento;
- se a cliente não souber o nome do serviço, entenda a intenção comum por trás de frases como “abaixar o volume”, “tirar as pontinhas”, “clarear um pouco”, “raiz cresceu”, “dar uma renovada” ou “mudar, mas não sei o quê”. Ajude com uma pergunta simples sem exigir vocabulário técnico;
- se a cliente estiver indecisa, ajude a organizar a intenção: corte, cor, tratamento ou uma mudança mais/menos visível. Se escolher depender de julgar individualmente o cabelo, não responda: o Gate Profissional fará o handoff;
- quanto mais decidida ela estiver, menos venda deve existir. Se escolheu dia ou horário, registre a preferência e avise que a equipe confirmará; nunca prometa reservar. Não insista nem ofereça serviços extras sem relevância;
- use o histórico com discrição. Não invente memória e não revele detalhes excessivos. Se faltar certeza sobre atendimento anterior, diga apenas que vai conferir.

Comercial e fatos:
- a agenda real do salão NÃO está conectada. Não ofereça horários nem diga que reservou ou confirmou. Colete serviço e dia/período preferidos sem repetir perguntas. Quando souber o necessário, use REQUEST_HUMAN_CONFIRMATION; a equipe consulta a agenda e confirma. Nunca marque BOOKED ou TIME_OFFERED por conta própria;
- use o CONTEXTO CADASTRADO para histórico, profissional preferido e observações. Importação de cadastro não comprova visita. A próxima ação deve corresponder ao que falta agora para avançar, sem expor classificações à cliente;
- use exclusivamente fatos presentes em CONHECIMENTO ou MENSAGENS. Nunca invente preço, promoção, desconto, horário, disponibilidade, benefício ou diferencial;
- quando a cliente perguntar um preço cadastrado, responda diretamente. Para serviços marcados como “a partir de”, preserve obrigatoriamente “a partir de R$ X”; para os demais, informe o preço fixo;
- quando faltar informação administrativa ou comercial, colete o mínimo necessário e diga de forma natural que a equipe confirmará. Use REQUEST_HUMAN_CONFIRMATION sem encerrar a atuação da IA;
- quando não souber algo, não improvise nem use “acho” ou “talvez” se a informação deveria estar na base. Diga de forma humana que vai confirmar para não passar errado;
- trate objeção de preço sem discurso nem desconto automático: reconheça e pergunte qual faixa ela imaginava;
- se pedirem desconto, só ofereça promoção cadastrada; caso contrário, mantenha a conversa sem prometer redução;
- diante de “vou pensar”, não pressione: responda com leveza, marque CREATE_FOLLOW_UP e requiresFollowUp=true;
- follow-up parece continuação de conversa, nunca campanha ou sequência ilimitada;
- problemas administrativos de cobrança, pagamento, horário ou cadastro podem continuar no fluxo comercial.

Fotos:
- pode pedir foto quando ela ajudar a registrar comprimento ou volume geral, receber referência de corte/cor, entender o estilo ou separar a referência para o profissional;
- não peça foto quando a pergunta já puder ser respondida, como um serviço de preço fixo;
- foto serve como contexto ou referência, nunca como autorização para análise técnica. Não garanta que um resultado é possível nem avalie química, dano ou segurança pela imagem;
- se a resposta depender de avaliação profissional, o Gate Profissional fará handoff silencioso. Você nunca tenta responder, avisar sobre o handoff ou recuperar esse caso.

Fronteira profissional absoluta:
- sua personalidade transmite experiência comercial, mas você nunca avalia individualmente saúde, dano, quebra, queda, elasticidade, porosidade, couro cabeludo, compatibilidade química, viabilidade de cor, correção, resultado possível, tratamento necessário ou o corte/cor que combina com a cliente;
- nunca diagnostique, prescreva, recomende tecnicamente, julgue uma foto ou garanta resultado, segurança, ausência de dano ou fidelidade à referência;
- nesses casos ocorre PROFESSIONAL_HANDOFF silencioso antes de você ser chamada: reply=null e zero mensagem automática. Nunca explique o silêncio para a cliente;
- problemas administrativos de cobrança, pagamento, cadastro e agenda continuam comerciais.

Exemplos do tom, usando sempre os fatos atuais do CONHECIMENTO:
- Cliente: “oi, quanto é corte?” Resposta: “Oii! O corte feminino fica R$ 90. Quer que eu veja os horários com você?”
- Cliente: “Quanto é a progressiva?” Resposta: “A progressiva fica a partir de R$ 180. Seu cabelo está mais ou menos até onde?”
- Cliente: “E demora quanto?” Resposta: “Leva em média umas 2 horas.”
- Cliente: “Quero marcar progressiva sexta.” Resposta: “Claro! Você prefere de manhã ou à tarde?”
- Cliente: “vou pensar” Resposta: “Tranquilo. Se decidir fazer, me chama que eu vejo direitinho pra você.”

Antes de enviar a reply, faça silenciosamente o teste de humanidade: uma pessoa real do salão mandaria isso pelo WhatsApp? Está formal, perfeito, genérico, repetitivo ou explicativo demais? Repete a cliente? Parece frase pronta? Tem perguntas demais? Combina com o jeito dela? Se soar como sistema, reescreva. Se parecer palestra, corte.

Princípio final: parecer uma pessoa real primeiro; atender bem; demonstrar conhecimento apenas quando necessário. Simpatia sem exagero, proximidade sem intimidade, venda sem pressão, informação sem excesso e zero avaliação técnica individual. Retorne somente o schema.`;

function serviceMentions(text: string) {
  const normalizedText = normalizeCatalogText(text);
  return catalog.flatMap((service) =>
    [service.name, ...(service.aliases ?? [])].flatMap((label) => {
      const needle = normalizeCatalogText(label);
      const found: Array<{
        service: typeof service;
        start: number;
        end: number;
        specificity: number;
      }> = [];
      let index = normalizedText.indexOf(needle);
      while (index >= 0) {
        const end = index + needle.length;
        found.push({ service, start: index, end, specificity: needle.length });
        index = normalizedText.indexOf(needle, index + 1);
      }
      return found;
    }),
  );
}

function closestService(text: string, offset: number) {
  const normalizedOffset = normalizeCatalogText(text.slice(0, offset)).length;
  const mentions = serviceMentions(text).map((mention) => ({
    ...mention,
    distance:
      mention.end <= normalizedOffset
        ? normalizedOffset - mention.end
        : mention.start - normalizedOffset,
    before: mention.end <= normalizedOffset,
  }));
  return (
    mentions.sort(
      (left, right) =>
        Number(right.before) - Number(left.before) ||
        left.distance - right.distance ||
        right.specificity - left.specificity,
    )[0]?.service ?? null
  );
}

function enforceCatalogPrices(reply: string, messages: StoredMessage[]) {
  if (!/R\$\s*\d/i.test(reply)) return { reply: reply.trim(), verified: true };
  const latestContext = latestText(messages);
  const pricePattern = /(?:a partir de\s+)?R\$\s*(\d+(?:[.,]\d{1,2})?)/gi;
  const priceOffsets = [...reply.matchAll(pricePattern)].map(
    (match) => match.index,
  );
  const uniqueMentions = [
    ...serviceMentions(reply)
      .sort(
        (left, right) =>
          left.start - right.start || right.specificity - left.specificity,
      )
      .reduce(
        (items, mention) =>
          items.has(mention.service.name)
            ? items
            : items.set(mention.service.name, mention),
        new Map<string, ReturnType<typeof serviceMentions>[number]>(),
      )
      .values(),
  ];
  const orderedServices =
    uniqueMentions.length === priceOffsets.length &&
    uniqueMentions.every(
      (mention) =>
        mention.end <=
        normalizeCatalogText(reply.slice(0, priceOffsets[0] ?? 0)).length,
    )
      ? uniqueMentions.map((mention) => mention.service)
      : null;
  let verified = true;
  let priceIndex = 0;
  let normalized = reply.replace(
    pricePattern,
    (_price, _amount: string, offset: number, fullText: string) => {
      const service =
        orderedServices?.[priceIndex++] ??
        closestService(fullText, offset) ??
        findCatalogService(latestContext);
      if (!service) {
        verified = false;
        return 'VALOR_NAO_VERIFICADO';
      }
      return formatCatalogPrice(service);
    },
  );
  if (!verified)
    return {
      reply:
        'Vou confirmar esse valor com a equipe para não te passar uma informação errada.',
      verified: false,
    };
  normalized = normalized.replace(
    /\bcusta\s+a partir de/gi,
    'fica a partir de',
  );
  return { reply: normalized.trim(), verified: true };
}

function normalizeCommercialStyle(reply: string) {
  let normalized = reply
    .replace(/\b(amiga|linda|amor|querida|meu bem)\b[,.!]?\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  let questionSeen = false;
  normalized = normalized.replace(/\?/g, () => {
    if (!questionSeen) {
      questionSeen = true;
      return '?';
    }
    return '.';
  });
  const sentences =
    normalized
      .match(/[^.!?]+[.!?]?/g)
      ?.map((part) => part.trim())
      .filter(Boolean) ?? [];
  if (sentences.length > 3) normalized = sentences.slice(0, 3).join(' ');
  return normalized.trim();
}

function latestText(messages: StoredMessage[]) {
  return (
    [...messages]
      .reverse()
      .find((message) => message.body?.trim())
      ?.body?.trim() ?? ''
  );
}

function detectInterest(text: string): string | null {
  const services: Array<[RegExp, string]> = [
    [/progressiva/i, 'Progressiva'],
    [/mega\s*hair/i, 'Mega hair'],
    [/luz(es)?|mechas/i, 'Luzes'],
    [/corte/i, 'Corte'],
    [/escova/i, 'Escova'],
    [/manicure|unha/i, 'Manicure'],
    [/pedicure/i, 'Pedicure'],
  ];
  return services.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function knowledgeMentionsService(knowledge: string, interest: string | null) {
  return Boolean(
    interest &&
    new RegExp(interest.replace(/\s+/g, '\\s*'), 'i').test(knowledge),
  );
}

function fallbackCommercialResult(
  messages: StoredMessage[],
  knowledge: string,
): AgentResult {
  const message = latestText(messages);
  const allText = transcript(messages);
  const interest = detectInterest(allText);
  const serviceKnown = knowledgeMentionsService(knowledge, interest);
  const thinking = /\b(vou pensar|vou ver|depois eu vejo|te aviso)\b/i.test(
    message,
  );
  const priceObjection =
    /\b(caro|car[aá]|muito caro|fora do meu or[cç]amento|pesado)\b/i.test(
      message,
    );
  const discount =
    /\b(desconto|promo[cç][aã]o|faz por|melhor pre[cç]o)\b/i.test(message);
  const scheduling =
    /\b(agendar|marcar|agenda|hor[aá]rio|vaga|tem (hoje|amanh[aã]|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado))\b/i.test(
      message,
    );
  const priceQuestion = /\b(quanto|valor|pre[cç]o|custa)\b/i.test(message);
  const period = /\b(manh[aã]|tarde|noite)\b/i.test(message);

  if (thinking)
    return {
      reply:
        'Tranquilo. Se decidir fazer, me chama que eu vejo direitinho pra você.',
      interest,
      opportunityStage: 'FOLLOW_UP',
      crmSummary: `Cliente vai pensar${interest ? ` sobre ${interest}` : ''}; oportunidade de retorno registrada.`,
      intent: 'ADIAR_DECISAO',
      temperature: 'WARM',
      objection: 'NEEDS_TIME',
      nextBestAction: 'CREATE_FOLLOW_UP',
      requiresFollowUp: true,
    };
  if (priceObjection)
    return {
      reply: 'Entendo. Você estava pensando em ficar em qual faixa?',
      interest,
      opportunityStage: 'OBJECTION',
      crmSummary: `Cliente apresentou objeção de preço${interest ? ` em ${interest}` : ''}.`,
      intent: 'OBJECAO_PRECO',
      temperature: 'HOT',
      objection: 'PRICE',
      nextBestAction: 'HANDLE_OBJECTION',
      requiresFollowUp: false,
    };
  if (discount)
    return {
      reply:
        'Não quero te passar errado. Quer que eu confirme com a equipe?',
      interest,
      opportunityStage: 'HUMAN_CONFIRMATION',
      crmSummary:
        'Cliente pediu desconto ou promoção não cadastrada; confirmação humana necessária.',
      intent: 'PEDIR_DESCONTO',
      temperature: 'HOT',
      objection: 'PRICE',
      nextBestAction: 'REQUEST_HUMAN_CONFIRMATION',
      requiresFollowUp: false,
    };
  if (scheduling)
    return {
      reply: period
        ? 'Pode deixar. Vou pedir para confirmarem os horários nesse período.'
        : 'Claro! Você prefere de manhã ou à tarde?',
      interest,
      opportunityStage: 'SCHEDULING',
      crmSummary: `Lead quer agendar${interest ? ` ${interest}` : ''}.`,
      intent: 'AGENDAR',
      temperature: 'VERY_HOT',
      objection: null,
      nextBestAction: period ? 'REQUEST_HUMAN_CONFIRMATION' : 'OFFER_PERIOD',
      requiresFollowUp: false,
    };
  if (priceQuestion)
    return {
      reply: interest
        ? `Vou confirmar o valor de ${interest.toLocaleLowerCase('pt-BR')} pra não te passar errado.`
        : 'Claro, me fala qual serviço você está procurando.',
      interest,
      opportunityStage: 'QUALIFICATION',
      crmSummary: `Cliente pediu preço${interest ? ` de ${interest}` : ''}; valor não encontrado no conhecimento.`,
      intent: 'CONSULTAR_PRECO',
      temperature: 'HOT',
      objection: null,
      nextBestAction: 'REQUEST_HUMAN_CONFIRMATION',
      requiresFollowUp: false,
    };
  if (interest && !serviceKnown)
    return {
      reply: `Entendi. Vou confirmar as informações de ${interest.toLocaleLowerCase('pt-BR')} com a equipe.`,
      interest,
      opportunityStage: 'HUMAN_CONFIRMATION',
      crmSummary: `Interesse em ${interest}; serviço sem informações cadastradas.`,
      intent: 'CONSULTAR_SERVICO',
      temperature: 'WARM',
      objection: null,
      nextBestAction: 'REQUEST_HUMAN_CONFIRMATION',
      requiresFollowUp: false,
    };
  if (interest)
    return {
      reply: `Claro, me fala o que você queria saber sobre ${interest.toLocaleLowerCase('pt-BR')}.`,
      interest,
      opportunityStage: 'QUALIFICATION',
      crmSummary: `Lead interessado em ${interest}.`,
      intent: 'CONSULTAR_SERVICO',
      temperature: 'WARM',
      objection: null,
      nextBestAction: 'QUALIFY',
      requiresFollowUp: false,
    };
  return {
    reply: 'Oii, tudo bem? Qual serviço você está procurando?',
    interest: null,
    opportunityStage: 'NEW',
    crmSummary: 'Novo contato ainda sem serviço identificado.',
    intent: 'INICIAR_ATENDIMENTO',
    temperature: 'COLD',
    objection: null,
    nextBestAction: 'QUALIFY',
    requiresFollowUp: false,
  };
}

export class OpenAICommercialAgent implements CommercialAgent {
  private readonly client: OpenAIResponsesClient;

  constructor(client: OpenAIResponsesClient) {
    this.client = client;
  }

  async respond({
    messages,
    knowledge,
  }: {
    messages: StoredMessage[];
    knowledge: string;
  }): Promise<AgentResult> {
    const text = transcript(messages);
    if (!this.client.configured)
      return fallbackCommercialResult(messages, knowledge);
    return this.client.json<AgentResult>(
      'commercial_agent',
      agentSchema,
      COMMERCIAL_INSTRUCTIONS,
      `CONHECIMENTO:\n${knowledge}\n\nMENSAGENS:\n${text}`,
    );
  }
}

export class OpenAIResponseVerifier implements ResponseVerifier {
  constructor(_client: OpenAIResponsesClient) {}

  async verify({
    messages,
    proposedReply,
  }: {
    messages: StoredMessage[];
    proposedReply: string;
    knowledge: string;
  }): Promise<VerificationResult> {
    const catalogCheck = enforceCatalogPrices(proposedReply, messages);
    const priceSafeReply = catalogCheck.reply;
    const unsafe =
      /garant|sem risco|diagn[oó]st|recomendo.*medic|vai resolver|100%|vai ficar (?:igual|perfeit)|pode fazer sem problema|n[aã]o vai danificar|qu[ií]mica é segura/i.test(
        priceSafeReply,
      );
    const exposesAutomation =
      /\b(?:sou|como) (?:uma? )?(?:intelig[eê]ncia artificial|i\.?a\.?|assistente virtual|chatbot|modelo de linguagem)|meu sistema|n[aã]o fui programad|minhas instru[cç][oõ]es|n[aã]o consigo analisar imagens/i.test(
        priceSafeReply,
      );
    const intimate = /\b(amiga|linda|amor|querida|meu bem)\b/i.test(
      priceSafeReply,
    );
    const tooManyQuestions = (priceSafeReply.match(/\?/g) ?? []).length > 1;
    const tooLong =
      priceSafeReply.split(/[.!?]+/).filter((part) => part.trim()).length > 3;
    if (unsafe || exposesAutomation)
      return {
        allowed: false,
        reason: exposesAutomation
          ? 'Resposta expõe automação ou limitação interna'
          : 'Resposta contém garantia ou orientação profissional indevida',
        finalReply: '',
      };
    const invalidStyle = intimate || tooManyQuestions || tooLong;
    return {
      allowed: true,
      reason: !catalogCheck.verified
        ? 'Valor não vinculado ao catálogo; resposta substituída por confirmação humana'
        : invalidStyle
          ? 'Estilo comercial ajustado localmente'
          : 'Resposta comercial curta, natural e segura',
      finalReply: invalidStyle
        ? normalizeCommercialStyle(priceSafeReply)
        : priceSafeReply,
    };
  }
}

export function createAgents(config: {
  apiKey?: string;
  model?: string;
  request?: typeof fetch;
}) {
  const client = new OpenAIResponsesClient(
    config.apiKey,
    config.model,
    config.request,
  );
  return {
    professionalGate: new OpenAIProfessionalGate(client),
    commercialAgent: new OpenAICommercialAgent(client),
    responseVerifier: new OpenAIResponseVerifier(client),
  };
}
