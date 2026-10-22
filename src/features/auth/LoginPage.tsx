import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, KeyRound, UserRound } from 'lucide-react';
import { api, errorMessage, isNetworkError } from '../../api/client';
import { homeFor, setSessionUser, useSession } from './session';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { Keypad, applyKey } from '../../components/ui/Keypad';
import { PIN_LENGTH } from '../../../shared/pin';
import { Segmented } from '../../components/ui/Segmented';
import { BrandMark } from '../../components/BrandMark';
import { Skeleton } from '../../components/ui/Misc';
import { useNow } from '../../hooks/useNow';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatDateLong, formatTime } from '../../../shared/dates';
import type { SessionUser } from '../../../shared/types';

interface StaffTile {
  id: string;
  name: string;
  role: string;
  roleKey: string;
}

export function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const now = useNow(15_000);
  const [mode, setMode] = useState<'pin' | 'password'>('pin');
  const [info, setInfo] = useState<{ business: { name: string; tagline: string; city: string }; staff: StaffTile[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<StaffTile | null>(null);
  const [pin, setPin] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'authed' && user && !params.get('switch')) navigate(params.get('next') || homeFor(user), { replace: true });
  }, [status, user, navigate, params]);

  useEffect(() => {
    api
      .get<{ business: { name: string; tagline: string; city: string }; staff: StaffTile[] }>('/auth/staff')
      .then((d) => {
        setInfo(d);
        if (!d.staff.length) setMode('password');
      })
      .catch((err) => setLoadError(isNetworkError(err) ? t('login.serverDown') : errorMessage(err)));
  }, [t]);

  const done = (u: SessionUser) => {
    setSessionUser(u);
    navigate(params.get('next') || homeFor(u), { replace: true });
  };

  const submitPin = async (value = pin) => {
    if (!picked || value.length !== PIN_LENGTH || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: SessionUser }>('/auth/pin', { userId: picked.id, pin: value });
      done(r.user);
    } catch (err) {
      setError(errorMessage(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: SessionUser }>('/auth/login', { username, password });
      done(r.user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // The 4th digit signs in straight away — no need to reach for the button.
  useEffect(() => {
    if (pin.length === PIN_LENGTH) void submitPin(pin);
  }, [pin]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== 'pin' || !picked) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => applyKey(p, e.key, PIN_LENGTH));
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') {
        e.preventDefault();
        void submitPin();
      }
      else if (e.key === 'Escape') (setPicked(null), setPin(''), setError(null));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex min-h-dvh flex-col bg-paper lg:flex-row">
      <section className="flex flex-col justify-between border-b border-line bg-surface px-6 py-6 lg:w-[42%] lg:border-r lg:border-b-0 lg:px-12 lg:py-10">
        <div className="flex items-center gap-3">
          <BrandMark size={40} />
          <div>
            <p className="text-lg leading-tight font-semibold">{info?.business.name ?? t('app.name')}</p>
            <p className="text-sm text-ink-3">{[info?.business.tagline, info?.business.city].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        <div className="mt-8 hidden lg:block">
          <p className="num text-[64px] leading-none font-semibold tracking-tight">{formatTime(new Date(now))}</p>
          <p className="mt-2 text-lg text-ink-3">{formatDateLong(new Date(now))}</p>
        </div>
        <div className="mt-6">
          <p className="text-2xl leading-tight font-semibold tracking-tight text-brand">{t('login.product')}</p>
          <p className="text-sm text-ink-3">{t('login.productTagline')}</p>
          <div className="mt-4 flex items-center gap-3">
            <span className="text-[13px] text-ink-4">{t('login.poweredBy')}</span>
            <img src="/dhishaai-logo.png" alt={t('login.makerLogoAlt')} className="h-9 w-auto lg:h-11" />
          </div>
          <p className="mt-4 hidden text-[13px] text-ink-4 lg:block">{t('login.footer')}</p>
        </div>
      </section>

      <section className="flex flex-1 items-start justify-center px-4 py-8 lg:items-center">
        <div className="w-full max-w-[460px]">
          <h1 className="text-2xl font-semibold">{t('login.title')}</h1>
          <p className="mt-1 text-sm text-ink-3">{t('login.subtitle')}</p>

          <Segmented
            className="mt-5"
            block
            label={t('login.method')}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
            options={[
              { value: 'pin', label: t('login.pin'), icon: <UserRound className="h-4 w-4" /> },
              { value: 'password', label: t('login.password'), icon: <KeyRound className="h-4 w-4" /> },
            ]}
          />

          {loadError && <p className="mt-4 rounded-md bg-warn-50 px-3 py-2 text-sm text-warn">{loadError}</p>}

          {mode === 'pin' ? (
            !picked ? (
              <div className="mt-5">
                <p className="mb-2 text-[13px] font-medium text-ink-2">{t('login.whoAreYou')}</p>
                {!info && !loadError ? (
                  <div className="grid grid-cols-2 gap-2">
                    {Array.from({ length: 4 }, (_, i) => (
                      <Skeleton key={i} className="h-[72px]" />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {info?.staff.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          setPicked(s);
                          setPin('');
                          setError(null);
                        }}
                        className="flex h-[72px] items-center gap-3 rounded-lg border border-line bg-surface px-3 text-left transition-colors hover:border-brand/50 hover:bg-brand-50/40"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper-2 text-sm font-semibold text-ink-2">
                          {s.name
                            .split(' ')
                            .map((p) => p[0])
                            .slice(0, 2)
                            .join('')}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{s.name}</span>
                          <span className="block text-[13px] text-ink-3">{s.role}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-5 rounded-lg border border-line bg-surface p-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setPicked(null);
                      setPin('');
                      setError(null);
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-paper"
                    aria-label={t('login.back')}
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <div>
                    <p className="font-semibold">{picked.name}</p>
                    <p className="text-[13px] text-ink-3">{t('login.enterPin')}</p>
                  </div>
                </div>
                <div className="my-5 flex justify-center gap-3" aria-label={t('approval.pinEntered', { n: pin.length })}>
                  {Array.from({ length: PIN_LENGTH }, (_, i) => (
                    <span key={i} className={cn('h-4 w-4 rounded-full border-2', i < pin.length ? 'border-brand bg-brand' : 'border-line-2')} />
                  ))}
                </div>
                {error && (
                  <p role="alert" className="mb-3 text-center text-sm text-danger">
                    {error}
                  </p>
                )}
                <Keypad onKey={(k) => setPin((p) => applyKey(p, k, PIN_LENGTH))} />
                <Button variant="primary" size="xl" block className="mt-3" loading={busy} disabled={pin.length !== PIN_LENGTH} onClick={() => submitPin()}>
                  {t('login.signIn')}
                </Button>
              </div>
            )
          ) : (
            <form
              className="mt-5 space-y-4 rounded-lg border border-line bg-surface p-5"
              onSubmit={(e) => {
                e.preventDefault();
                void submitPassword();
              }}
            >
              <Field label={t('login.username')} htmlFor="login-user">
                <Input id="login-user" size="lg" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
              </Field>
              <Field label={t('login.passwordLabel')} htmlFor="login-pass">
                <Input id="login-pass" size="lg" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              {error && (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              )}
              <Button type="submit" variant="primary" size="xl" block loading={busy} disabled={!username || !password}>
                {t('login.signIn')}
              </Button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
