import registry from './montages/canonical-montages.json';

export type MontageId = keyof typeof registry.montages;

type RawMontage = {
  label: string;
  channels?: string[];
  base?: MontageId;
  extends?: MontageId;
  additionalChannels?: string[];
  vendor?: string;
  capModel?: string;
};

export interface MontageProfile {
  id: MontageId;
  label: string;
  channels: string[];
  vendor?: string;
  capModel?: string;
}

const rawMontages = registry.montages as Record<MontageId, RawMontage>;
const channelAliases = registry.channelAliases as Record<string, string>;

function uniqueChannels(channels: string[]): string[] {
  return Array.from(new Set(channels));
}

export function getMontageProfile(id: MontageId): MontageProfile {
  const montage = rawMontages[id];
  if (!montage) {
    throw new Error(`Unknown montage profile: ${String(id)}`);
  }

  const parentId = montage.base ?? montage.extends;
  const parentChannels = parentId ? getMontageProfile(parentId).channels : [];
  const ownChannels = montage.channels ?? [];
  const additionalChannels = montage.additionalChannels ?? [];

  return {
    id,
    label: montage.label,
    channels: uniqueChannels([...parentChannels, ...ownChannels, ...additionalChannels]),
    vendor: montage.vendor,
    capModel: montage.capModel,
  };
}

export function getAllMontageProfiles(): MontageProfile[] {
  return (Object.keys(rawMontages) as MontageId[]).map(getMontageProfile);
}

export function getAllKnownEEGChannels(): string[] {
  return uniqueChannels(
    getAllMontageProfiles().flatMap((profile) => profile.channels)
  );
}

export function normalizeEEGChannelName(channelName: string): string {
  let normalized = channelName.trim().replace(/\s+/g, '');

  if (/^A2-A1$/i.test(normalized)) {
    return 'A1';
  }

  normalized = normalized.replace(/^(EEG|ECG|EMG|EOG)/i, '');
  normalized = normalized.replace(/-(LE|REF|AVG|A1|A2|CZ|M1|M2)$/i, '');

  const alias = channelAliases[normalized.toUpperCase()];
  return alias ?? normalized;
}

export function isKnownEEGChannel(channelName: string): boolean {
  const normalized = normalizeEEGChannelName(channelName).toLowerCase();
  return getAllKnownEEGChannels().some((channel) => channel.toLowerCase() === normalized);
}

export const CANONICAL_MONTAGE_REGISTRY = registry;
export const CHANNEL_ALIASES = channelAliases;
