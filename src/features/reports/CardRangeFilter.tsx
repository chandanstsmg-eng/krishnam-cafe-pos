import { useState } from 'react';
import { Input, Select } from '../../components/ui/Field';
import { useT } from '../../i18n';
import { businessDate, formatDate } from '../../../shared/dates';
import { presetRange, type Preset } from './ranges';

export interface CardRange {
  preset: Preset;
  from: string;
  to: string;
}

/** Today / Yesterday / This week / … for one dashboard card. Custom shows two date boxes. */
export function useCardRange() {
  const [range, setRange] = useState<CardRange>(() => ({ preset: 'today', ...presetRange('today') }));
  return [range, setRange] as const;
}

/** How the chosen period reads in the card's subtitle. */
export function rangeText(r: CardRange, t: ReturnType<typeof useT>) {
  const names: Record<Exclude<Preset, 'custom'>, string> = {
    today: t('reportsPage.today'),
    yesterday: t('reportsPage.yesterday'),
    week: t('reportsPage.thisWeek'),
    month: t('reportsPage.thisMonth'),
    lastMonth: t('reportsPage.lastMonth'),
  };
  if (r.preset !== 'custom') return names[r.preset];
  return r.from === r.to ? formatDate(r.from) : `${formatDate(r.from)} – ${formatDate(r.to)}`;
}

export function CardRangeFilter({ id, value, onChange }: { id: string; value: CardRange; onChange: (r: CardRange) => void }) {
  const t = useT();
  const today = businessDate();
  const pick = (preset: Preset) => onChange(preset === 'custom' ? { ...value, preset } : { preset, ...presetRange(preset, today) });
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Select id={id} aria-label={t('dashboard.period')} value={value.preset} onChange={(e) => pick(e.target.value as Preset)} className="h-8 w-auto py-0 text-[13px]">
        <option value="today">{t('reportsPage.today')}</option>
        <option value="yesterday">{t('reportsPage.yesterday')}</option>
        <option value="week">{t('reportsPage.thisWeek')}</option>
        <option value="month">{t('reportsPage.thisMonth')}</option>
        <option value="lastMonth">{t('reportsPage.lastMonth')}</option>
        <option value="custom">{t('reportsPage.custom')}</option>
      </Select>
      {value.preset === 'custom' && (
        <>
          <Input
            type="date"
            aria-label={t('common.from')}
            value={value.from}
            max={today}
            onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value, to: e.target.value > value.to ? e.target.value : value.to })}
            className="h-8 w-[9.5rem] py-0 text-[13px]"
          />
          <Input
            type="date"
            aria-label={t('common.to')}
            value={value.to}
            min={value.from}
            max={today}
            onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value, from: e.target.value < value.from ? e.target.value : value.from })}
            className="h-8 w-[9.5rem] py-0 text-[13px]"
          />
        </>
      )}
    </div>
  );
}
