export type CatalogService = {
  name: string;
  priceCents: number;
  startingAt: boolean;
  durationMinutes: number;
  aliases?: string[];
};

export const professionals = [
  'Joelma Pereira',
  'Rogerio Batista',
  'Alaíde Batista de Souza',
  'Gisele de Souza Silva',
  'Amanda Silva',
  'Ana Lucia da Silva Pedro',
  'Horeb Florine',
  'Secretaria / recepção',
] as const;

export const catalog: CatalogService[] = [
  {
    name: 'Corte masculino',
    priceCents: 6000,
    startingAt: false,
    durationMinutes: 40,
  },
  {
    name: 'Corte feminino',
    priceCents: 9000,
    startingAt: false,
    durationMinutes: 100,
    aliases: ['corte'],
  },
  { name: 'Escova', priceCents: 5000, startingAt: false, durationMinutes: 60 },
  {
    name: 'Coloração',
    priceCents: 13000,
    startingAt: true,
    durationMinutes: 100,
  },
  { name: 'Mechas', priceCents: 30000, startingAt: true, durationMinutes: 300 },
  {
    name: 'Progressiva',
    priceCents: 18000,
    startingAt: true,
    durationMinutes: 120,
  },
  {
    name: 'Design de sobrancelha',
    priceCents: 5000,
    startingAt: false,
    durationMinutes: 40,
    aliases: ['design sobrancelha'],
  },
  {
    name: 'Micropigmentação',
    priceCents: 40000,
    startingAt: true,
    durationMinutes: 180,
  },
  {
    name: 'Maquiagem',
    priceCents: 20000,
    startingAt: false,
    durationMinutes: 120,
  },
  {
    name: 'Penteado',
    priceCents: 20000,
    startingAt: true,
    durationMinutes: 120,
  },
  {
    name: 'Manicure / mão',
    priceCents: 4000,
    startingAt: false,
    durationMinutes: 50,
    aliases: ['manicure', 'mão'],
  },
  {
    name: 'Pedicure',
    priceCents: 4500,
    startingAt: false,
    durationMinutes: 50,
  },
  {
    name: 'Spa dos pés — cadastro 1',
    priceCents: 8500,
    startingAt: false,
    durationMinutes: 100,
    aliases: ['spa dos pés cadastro 1'],
  },
  {
    name: 'Depilação de buço',
    priceCents: 2500,
    startingAt: false,
    durationMinutes: 30,
  },
  {
    name: 'Depilação de virilha',
    priceCents: 8000,
    startingAt: false,
    durationMinutes: 60,
  },
  {
    name: 'Depilação de perna com roll-on',
    priceCents: 7000,
    startingAt: false,
    durationMinutes: 60,
    aliases: ['depilação de perna'],
  },
  {
    name: 'Depilação de axila',
    priceCents: 3500,
    startingAt: false,
    durationMinutes: 40,
  },
  {
    name: 'Depilação de costas',
    priceCents: 6000,
    startingAt: false,
    durationMinutes: 60,
  },
  {
    name: 'Depilação de virilha simples — cadastro 1',
    priceCents: 6500,
    startingAt: false,
    durationMinutes: 60,
    aliases: ['virilha simples cadastro 1'],
  },
  {
    name: 'Gloss express',
    priceCents: 15000,
    startingAt: true,
    durationMinutes: 100,
  },
  {
    name: 'Hidratação',
    priceCents: 7000,
    startingAt: true,
    durationMinutes: 100,
  },
  {
    name: 'Reconstrução Joico',
    priceCents: 25000,
    startingAt: true,
    durationMinutes: 120,
    aliases: ['reconstrução'],
  },
  {
    name: 'Botox capilar',
    priceCents: 15000,
    startingAt: true,
    durationMinutes: 120,
    aliases: ['botox'],
  },
  {
    name: 'Limpeza e correção de cor',
    priceCents: 30000,
    startingAt: true,
    durationMinutes: 300,
    aliases: ['correção de cor'],
  },
  {
    name: 'Tonalização',
    priceCents: 13000,
    startingAt: true,
    durationMinutes: 100,
  },
  {
    name: 'Aplicação de coloração',
    priceCents: 9000,
    startingAt: true,
    durationMinutes: 100,
  },
  { name: 'Barba', priceCents: 4000, startingAt: false, durationMinutes: 60 },
  {
    name: 'Esmaltação de unha',
    priceCents: 2500,
    startingAt: false,
    durationMinutes: 40,
    aliases: ['esmaltação'],
  },
  {
    name: 'Mega hair',
    priceCents: 35000,
    startingAt: true,
    durationMinutes: 300,
  },
  {
    name: 'Mão e pé',
    priceCents: 8500,
    startingAt: false,
    durationMinutes: 100,
  },
  {
    name: 'Corte de unha',
    priceCents: 2500,
    startingAt: false,
    durationMinutes: 40,
  },
  {
    name: 'Colocação de alongamento',
    priceCents: 15000,
    startingAt: true,
    durationMinutes: 120,
  },
  {
    name: 'Retirada de unha em gel',
    priceCents: 10000,
    startingAt: false,
    durationMinutes: 120,
  },
  { name: 'Luzes', priceCents: 20000, startingAt: true, durationMinutes: 240 },
  {
    name: 'Francesinha',
    priceCents: 500,
    startingAt: false,
    durationMinutes: 40,
  },
  {
    name: 'Esmaltação em gel',
    priceCents: 7000,
    startingAt: false,
    durationMinutes: 120,
  },
  {
    name: 'Spa dos pés — cadastro 2',
    priceCents: 6000,
    startingAt: false,
    durationMinutes: 100,
    aliases: ['spa dos pés cadastro 2'],
  },
  {
    name: 'Denise sobrancelha',
    priceCents: 20000,
    startingAt: false,
    durationMinutes: 40,
  },
  {
    name: 'Corte bordado',
    priceCents: 12000,
    startingAt: false,
    durationMinutes: 100,
  },
  {
    name: 'Depilação — cadastro geral',
    priceCents: 12000,
    startingAt: false,
    durationMinutes: 60,
    aliases: ['depilação cadastro geral'],
  },
  {
    name: 'Depilação simples de virilha — cadastro 2',
    priceCents: 7000,
    startingAt: false,
    durationMinutes: 60,
    aliases: ['virilha simples cadastro 2'],
  },
  {
    name: 'Teste de mecha',
    priceCents: 20000,
    startingAt: false,
    durationMinutes: 120,
  },
  {
    name: 'Avaliação de limpeza de pele',
    priceCents: 6000,
    startingAt: false,
    durationMinutes: 30,
  },
  {
    name: 'Blindagem',
    priceCents: 10000,
    startingAt: false,
    durationMinutes: 120,
  },
  {
    name: 'Blindagem + esmaltação',
    priceCents: 12500,
    startingAt: false,
    durationMinutes: 150,
  },
  {
    name: 'Blindagem + esmaltação em gel',
    priceCents: 15000,
    startingAt: false,
    durationMinutes: 150,
  },
  {
    name: 'Manutenção de alongamento',
    priceCents: 7500,
    startingAt: true,
    durationMinutes: 120,
  },
];

export function normalizeCatalogText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

export function findCatalogService(value: string): CatalogService | null {
  const normalized = normalizeCatalogText(value);
  const exact = catalog.find(
    (service) =>
      normalizeCatalogText(service.name) === normalized ||
      service.aliases?.some(
        (alias) => normalizeCatalogText(alias) === normalized,
      ),
  );
  if (exact) return exact;
  const matches = catalog.filter((service) =>
    [service.name, ...(service.aliases ?? [])].some((name) =>
      normalized.includes(normalizeCatalogText(name)),
    ),
  );
  return (
    matches.sort(
      (left, right) =>
        normalizeCatalogText(right.name).length -
        normalizeCatalogText(left.name).length,
    )[0] ?? null
  );
}

export function findProfessional(value: string) {
  const normalized = normalizeCatalogText(value);
  return (
    professionals.find(
      (professional) => normalizeCatalogText(professional) === normalized,
    ) ?? null
  );
}

export function formatCatalogPrice(service: CatalogService) {
  const amount = (service.priceCents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${service.startingAt ? 'a partir de ' : ''}R$ ${amount}`;
}
