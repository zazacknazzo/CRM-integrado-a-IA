import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgents } from '../agents/openai-agents.ts';
import type { StoredMessage } from '../core/contracts.ts';

function message(body: string): StoredMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    externalId: 'in1',
    channel: 'SIMULATOR',
    direction: 'INBOUND',
    senderType: 'CUSTOMER',
    messageType: 'text',
    body,
    mediaId: null,
    status: 'delivered',
    processingState: 'RECEIVED',
    createdAt: new Date().toISOString(),
  };
}

function imageMessage(body: string): StoredMessage {
  return { ...message(body), messageType: 'image', mediaId: 'image-1' };
}

const agents = createAgents({});

test('fallback handles price objection without inventing a discount', async () => {
  const result = await agents.commercialAgent.respond({
    messages: [message('Achei muito caro')],
    knowledge: '',
  });
  assert.equal(result.objection, 'PRICE');
  assert.equal(result.nextBestAction, 'HANDLE_OBJECTION');
  assert.match(result.reply, /qual faixa/i);
  assert.doesNotMatch(result.reply, /desconto|promoção/i);
});

test('fallback treats scheduling intent as very hot and asks only for a period', async () => {
  const result = await agents.commercialAgent.respond({
    messages: [message('Quero agendar uma progressiva')],
    knowledge: '',
  });
  assert.equal(result.temperature, 'VERY_HOT');
  assert.equal(result.nextBestAction, 'OFFER_PERIOD');
  assert.equal((result.reply.match(/\?/g) ?? []).length, 1);
  assert.doesNotMatch(result.reply, /benefício|resultado|qualidade/i);
});

test('fallback marks vou pensar for a restrained follow-up', async () => {
  const result = await agents.commercialAgent.respond({
    messages: [message('Vou pensar e te aviso')],
    knowledge: '',
  });
  assert.equal(result.requiresFollowUp, true);
  assert.equal(result.opportunityStage, 'FOLLOW_UP');
  assert.equal(result.nextBestAction, 'CREATE_FOLLOW_UP');
});

test('fallback does not invent an unknown price', async () => {
  const result = await agents.commercialAgent.respond({
    messages: [message('Quanto custa progressiva?')],
    knowledge: '',
  });
  assert.equal(result.nextBestAction, 'REQUEST_HUMAN_CONFIRMATION');
  assert.doesNotMatch(result.reply, /R\$|\b\d{2,}\b/);
});

test('professional gate silently separates technical cases from administrative complaints', async () => {
  const technical = await agents.professionalGate.evaluate({
    messages: [message('Fiz química recente e meu cabelo está quebrando')],
    knowledge: '',
  });
  const administrative = await agents.professionalGate.evaluate({
    messages: [message('Tive uma cobrança duplicada no agendamento')],
    knowledge: '',
  });
  assert.equal(technical.decision, 'PROFESSIONAL_HANDOFF');
  assert.equal(administrative.decision, 'ALLOW_COMMERCIAL');
});

test('professional gate allows color services but blocks individualized colorimetry', async () => {
  const commercial = await agents.professionalGate.evaluate({
    messages: [message('Quanto custa coloração e quanto tempo demora?')],
    knowledge: '',
  });
  const technical = await agents.professionalGate.evaluate({
    messages: [
      message('Analise meu cabelo e diga qual tom de loiro combina comigo'),
    ],
    knowledge: '',
  });
  const compatibility = await agents.professionalGate.evaluate({
    messages: [message('Posso fazer luzes depois de uma progressiva?')],
    knowledge: '',
  });
  assert.equal(commercial.decision, 'ALLOW_COMMERCIAL');
  assert.equal(technical.decision, 'PROFESSIONAL_HANDOFF');
  assert.equal(compatibility.decision, 'PROFESSIONAL_HANDOFF');
});

test('professional gate blocks individualized treatment, damage and style recommendations', async () => {
  const cases = [
    'Qual tratamento meu cabelo precisa?',
    'Esse mega hair vai danificar meu cabelo?',
    'Você acha que meu cabelo está elástico?',
    'Qual corte combina melhor comigo?',
    'O que aconteceu com meu cabelo?',
  ];
  for (const body of cases) {
    const result = await agents.professionalGate.evaluate({
      messages: [message(body)],
      knowledge: '',
    });
    assert.equal(result.decision, 'PROFESSIONAL_HANDOFF', body);
  }
});

test('professional gate allows a captioned style reference but blocks visual technical judgment', async () => {
  const reference = await agents.professionalGate.evaluate({
    messages: [imageMessage('Referência do corte que eu quero')],
    knowledge: '',
  });
  const feasibility = await agents.professionalGate.evaluate({
    messages: [imageMessage('Dá pra chegar nesse loiro?')],
    knowledge: '',
  });
  const noContext = await agents.professionalGate.evaluate({
    messages: [imageMessage('')],
    knowledge: '',
  });
  assert.equal(reference.decision, 'ALLOW_COMMERCIAL');
  assert.equal(feasibility.decision, 'PROFESSIONAL_HANDOFF');
  assert.equal(noContext.decision, 'PROFESSIONAL_HANDOFF');
});

test('response verifier normalizes intimate language and multiple questions without going silent', async () => {
  const intimate = await agents.responseVerifier.verify({
    messages: [message('Oi')],
    proposedReply: 'Oi, linda. Qual serviço você quer?',
    knowledge: '',
  });
  const multiple = await agents.responseVerifier.verify({
    messages: [message('Oi')],
    proposedReply: 'Qual serviço? Prefere manhã ou tarde?',
    knowledge: '',
  });
  assert.equal(intimate.allowed, true);
  assert.doesNotMatch(intimate.finalReply, /linda/i);
  assert.equal(multiple.allowed, true);
  assert.equal((multiple.finalReply.match(/\?/g) ?? []).length, 1);
});

test('response verifier never presents complex services as a closed price', async () => {
  const result = await agents.responseVerifier.verify({
    messages: [message('Quanto custa progressiva?')],
    proposedReply: 'A progressiva custa R$ 180.',
    knowledge: '',
  });
  assert.equal(result.allowed, true);
  assert.match(result.finalReply, /a partir de R\$ 180/i);
  assert.doesNotMatch(result.finalReply, /custa R\$ 180/i);
});

test('response verifier never exposes automation to the customer', async () => {
  const result = await agents.responseVerifier.verify({
    messages: [message('Você consegue analisar essa foto?')],
    proposedReply: 'Como IA, não consigo analisar imagens.',
    knowledge: '',
  });
  assert.equal(result.allowed, false);
  assert.equal(result.finalReply, '');
});

test('response verifier keeps fixed services as a closed price even after a complex-service conversation', async () => {
  const result = await agents.responseVerifier.verify({
    messages: [
      message('Quero progressiva'),
      message('E quanto custa o corte masculino?'),
    ],
    proposedReply: 'O corte masculino fica a partir de R$ 60.',
    knowledge: '',
  });
  assert.equal(result.allowed, true);
  assert.match(result.finalReply, /R\$ 60/i);
  assert.doesNotMatch(result.finalReply, /a partir de R\$ 60/i);
});

test('response verifier applies the right price language to mixed services', async () => {
  const result = await agents.responseVerifier.verify({
    messages: [message('Quanto ficam progressiva e manicure?')],
    proposedReply:
      'A progressiva custa R$ 180 e a manicure fica a partir de R$ 40.',
    knowledge: '',
  });
  assert.equal(result.allowed, true);
  assert.match(result.finalReply, /progressiva fica a partir de R\$ 180/i);
  assert.match(result.finalReply, /manicure fica R\$ 40/i);
  assert.doesNotMatch(result.finalReply, /manicure fica a partir/i);
});

test('response verifier pairs grouped service names and prices in order', async () => {
  const result = await agents.responseVerifier.verify({
    messages: [message('Quanto ficam progressiva e manicure?')],
    proposedReply: 'Progressiva e manicure ficam R$ 999 e R$ 888.',
    knowledge: '',
  });
  assert.equal(result.allowed, true);
  assert.match(
    result.finalReply,
    /progressiva e manicure ficam a partir de R\$ 180 e R\$ 40/i,
  );
});

test('response verifier replaces a hallucinated amount with the catalog price', async () => {
  const result = await agents.responseVerifier.verify({
    messages: [message('Quanto custa luzes?')],
    proposedReply: 'As luzes ficam por R$ 999.',
    knowledge: '',
  });
  assert.equal(result.allowed, true);
  assert.match(result.finalReply, /a partir de R\$ 200/i);
  assert.doesNotMatch(result.finalReply, /999/);
});

test('response verifier replaces an unrecognized price with a human confirmation', async () => {
  const result = await agents.responseVerifier.verify({
    messages: [message('Quanto custa o pacote de noiva?')],
    proposedReply: 'O pacote de noiva fica R$ 700.',
    knowledge: '',
  });
  assert.equal(result.allowed, true);
  assert.match(result.finalReply, /confirmar esse valor com a equipe/i);
  assert.doesNotMatch(result.finalReply, /700/);
});

test('configured normal flow uses one paid model request with low reasoning and verbosity', async () => {
  let calls = 0;
  let requestBody: Record<string, unknown> = {};
  const request = (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls += 1;
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          reply:
            'Oii! O corte feminino fica R$ 90. Quer que eu veja os horários?',
          interest: 'Corte',
          opportunityStage: 'QUALIFICATION',
          crmSummary: 'Cliente interessado em corte.',
          intent: 'CONSULTAR_PRECO',
          temperature: 'HOT',
          objection: null,
          nextBestAction: 'OFFER_PERIOD',
          requiresFollowUp: false,
        }),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;
  const configured = createAgents({
    apiKey: 'test',
    model: 'gpt-5.6-luna',
    request,
  });
  const messages = [message('Quanto custa o corte feminino?')];
  const gate = await configured.professionalGate.evaluate({
    messages,
    knowledge: 'Corte feminino: R$ 90',
  });
  assert.equal(gate.decision, 'ALLOW_COMMERCIAL');
  const answer = await configured.commercialAgent.respond({
    messages,
    knowledge: 'Corte feminino: R$ 90',
  });
  const verified = await configured.responseVerifier.verify({
    messages,
    proposedReply: answer.reply,
    knowledge: 'Corte feminino: R$ 90',
  });
  assert.equal(verified.allowed, true);
  assert.equal(calls, 1);
  assert.deepEqual(requestBody.reasoning, { effort: 'low' });
  assert.equal((requestBody.text as { verbosity?: string }).verbosity, 'low');
  assert.match(
    String(requestBody.instructions),
    /cabeleireira experiente/i,
  );
  assert.match(String(requestBody.instructions), /teste de humanidade/i);
});
