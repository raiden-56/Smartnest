import { startOfHour, startOfLocalDay } from './time.js';
import type { DeviceState, EnergyDto } from '@smartnest/shared';
import { prisma } from '../db.js';
import { parseCapabilities } from '../lib/dto.js';

export const ENERGY_ROLES = ['consumption', 'solar', 'battery', 'ev', 'device'] as const;
export type EnergyRole = (typeof ENERGY_ROLES)[number];

export function energyRoleOf(metadata: unknown): EnergyRole {
  const r = (metadata as { energyRole?: string } | null)?.energyRole;
  return (ENERGY_ROLES as readonly string[]).includes(r ?? '') ? (r as EnergyRole) : 'device';
}

/**
 * Add a kWh delta (from a cumulative energy counter) into the device's hourly bucket.
 * Negative deltas (counter reset) and implausible jumps are ignored rather than guessed.
 */
export async function recordEnergyDelta(
  device: { id: string; homeId: string; metadata: unknown; integration: { isDemo: boolean } },
  deltaKWh: number,
  at: Date,
): Promise<void> {
  if (!(deltaKWh > 0) || deltaKWh > 100) return;
  const periodStart = startOfHour(at);
  const kind = energyRoleOf(device.metadata);
  await prisma.energyReading.upsert({
    where: { deviceId_kind_periodStart: { deviceId: device.id, kind, periodStart } },
    create: { homeId: device.homeId, deviceId: device.id, kind, periodStart, kWh: deltaKWh, isDemo: device.integration.isDemo },
    update: { kWh: { increment: deltaKWh } },
  });
}

export interface EnergyRange {
  from: Date;
  to: Date;
  bucket: 'hour' | 'day';
}

export async function getEnergy(homeId: string, range: EnergyRange, thresholdW: number | null): Promise<EnergyDto> {
  const home = await prisma.home.findUniqueOrThrow({ where: { id: homeId } });
  const devices = await prisma.device.findMany({
    where: { homeId, capabilities: { some: { type: { in: ['power', 'energy', 'charging'] } } } },
    include: { capabilities: true, integration: { select: { isDemo: true } } },
  });

  const sources: EnergyDto['sources'] = [];
  let currentPowerW: number | null = null;
  let solarPowerW: number | null = null;
  let batteryLevel: number | null = null;
  let devicePowerSum: number | null = null;
  const evCharging: EnergyDto['evCharging'] = [];

  for (const d of devices) {
    const s = d.state as DeviceState;
    const role = energyRoleOf(d.metadata);
    const caps = parseCapabilities(d.capabilities);
    const online = d.connectivity === 'online';
    if (role !== 'device') sources.push({ deviceId: d.id, deviceName: d.name, kind: role === 'consumption' ? 'consumption' : role, isDemo: d.integration.isDemo });
    if (!online) continue;
    if (role === 'consumption' && s.powerW !== undefined) currentPowerW = (currentPowerW ?? 0) + s.powerW;
    if (role === 'solar' && s.powerW !== undefined) solarPowerW = (solarPowerW ?? 0) + s.powerW;
    if (role === 'battery' && s.batteryLevel !== undefined) batteryLevel = s.batteryLevel;
    if (role === 'ev' || caps.some((c) => c.type === 'charging')) {
      if (role === 'ev' || d.category === 'energy') evCharging.push({ deviceId: d.id, name: d.name, charging: !!s.charging, powerW: s.powerW ?? null });
    }
    if ((role === 'device' || role === 'ev') && s.powerW !== undefined) devicePowerSum = (devicePowerSum ?? 0) + s.powerW;
  }
  const hasWholeHomeMeter = sources.some((s) => s.kind === 'consumption');
  if (!hasWholeHomeMeter && devicePowerSum !== null) currentPowerW = devicePowerSum;
  if (!hasWholeHomeMeter) {
    for (const d of devices) {
      if (energyRoleOf(d.metadata) === 'device' && d.capabilities.some((c) => c.type === 'energy')) {
        sources.push({ deviceId: d.id, deviceName: d.name, kind: 'consumption', isDemo: d.integration.isDemo });
      }
    }
  }

  const readings = await prisma.energyReading.findMany({
    where: { homeId, periodStart: { gte: range.from, lt: range.to } },
    select: { deviceId: true, kind: true, periodStart: true, kWh: true },
  });

  const consumptionKinds = hasWholeHomeMeter ? new Set(['consumption']) : new Set(['device', 'ev']);
  const bucketKey = (d: Date) => (range.bucket === 'hour' ? startOfHour(d) : startOfDayUtc(d)).toISOString();
  const series = new Map<string, { consumptionKWh: number; solarKWh: number }>();
  for (let t = new Date(range.bucket === 'hour' ? startOfHour(range.from) : startOfDayUtc(range.from)); t < range.to; t = new Date(t.getTime() + (range.bucket === 'hour' ? 3600_000 : 86400_000))) {
    series.set(t.toISOString(), { consumptionKWh: 0, solarKWh: 0 });
  }
  const perDeviceKWh = new Map<string, number>();
  for (const r of readings) {
    const b = series.get(bucketKey(r.periodStart));
    if (b) {
      if (consumptionKinds.has(r.kind)) b.consumptionKWh += r.kWh;
      if (r.kind === 'solar') b.solarKWh += r.kWh;
    }
    if (r.kind === 'device' || r.kind === 'ev') perDeviceKWh.set(r.deviceId, (perDeviceKWh.get(r.deviceId) ?? 0) + r.kWh);
  }

  const now = new Date();
  const sumSince = async (since: Date, kinds: string[]) => {
    const agg = await prisma.energyReading.aggregate({ where: { homeId, kind: { in: kinds }, periodStart: { gte: since } }, _sum: { kWh: true }, _count: true });
    return agg._count ? (agg._sum.kWh ?? 0) : null;
  };
  const kinds = [...consumptionKinds];
  const dayStart = startOfLocalDay(home.timezone, now);
  const [todayKWh, weekKWh, monthKWh, solarTodayKWh] = await Promise.all([
    sumSince(dayStart, kinds),
    sumSince(new Date(now.getTime() - 7 * 86400_000), kinds),
    sumSince(new Date(now.getTime() - 30 * 86400_000), kinds),
    sumSince(dayStart, ['solar']),
  ]);

  const nameById = new Map(devices.map((d) => [d.id, d]));
  const perDevice = [...perDeviceKWh.entries()]
    .map(([deviceId, kWh]) => ({ deviceId, name: nameById.get(deviceId)?.name ?? 'Removed device', kWh: round(kWh), currentW: (nameById.get(deviceId)?.state as DeviceState | undefined)?.powerW ?? null }))
    .sort((a, b) => b.kWh - a.kWh);

  return {
    available: sources.length > 0 || readings.length > 0,
    sources,
    currentPowerW,
    solarPowerW,
    batteryLevel,
    evCharging,
    totals: { todayKWh: maybeRound(todayKWh), weekKWh: maybeRound(weekKWh), monthKWh: maybeRound(monthKWh), solarTodayKWh: maybeRound(solarTodayKWh) },
    series: [...series.entries()].map(([t, v]) => ({ t, consumptionKWh: round(v.consumptionKWh), solarKWh: round(v.solarKWh) })),
    perDevice,
    tariff: home.tariffPerKWh !== null && home.currency ? { perKWh: home.tariffPerKWh, currency: home.currency } : null,
    thresholdW,
    range: { from: range.from.toISOString(), to: range.to.toISOString(), bucket: range.bucket },
  };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const maybeRound = (v: number | null) => (v === null ? null : round(v));
function startOfDayUtc(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
