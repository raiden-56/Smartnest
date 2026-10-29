import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert, Autocomplete, Box, Button, Card, CardActionArea, Chip, CircularProgress, LinearProgress, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, FlaskConical, Home, KeyRound, LogOut, Plus, Radar, Sparkles, Users } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { DEFAULT_ROOM_SUGGESTIONS, INTEGRATIONS, ROOM_ICONS, type DiscoveredDeviceDto, type IntegrationDto } from '@smartnest/shared';
import {
  api, toApiError, useAddDemoIntegrationMutation, useCompleteOnboardingMutation, useCreateDemoHomeMutation, useCreateHomeMutation, useCreateRoomMutation,
  useDeviceCountsQuery, useDiscoverMutation, useHomeQuery, useHomesQuery, useLogoutMutation, useRoomsQuery, type ImportResult,
} from '../../api/api';
import { resetLive, setCurrentHome, useAppDispatch, useAppSelector } from '../../app/store';
import { AppIcon } from '../../components/common/AppIcon';
import { tokens } from '../../theme/theme';
import { DiscoveryReview, HomeAssistantForm, ImportResults } from '../integrations/components';

const STEPS = ['Welcome', 'Your home', 'Connect', 'Rooms', 'Devices', 'Finish'];

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function allTimezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [browserTimezone(), 'UTC'];
  }
}

const homeFormSchema = z.object({
  name: z.string().trim().min(1, 'Name your home').max(80),
  timezone: z.string().min(1, 'Choose a timezone'),
  temperatureUnit: z.enum(['C', 'F']),
});
type HomeForm = z.infer<typeof homeFormSchema>;

function Logo() {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center">
      <Box sx={{ width: 36, height: 36, borderRadius: '11px', bgcolor: 'primary.main', display: 'grid', placeItems: 'center' }} aria-hidden>
        <svg viewBox="0 0 64 64" width="24" height="24">
          <path d="M14 33 32 17l18 16v15a3 3 0 0 1-3 3H37V38H27v13H17a3 3 0 0 1-3-3Z" fill="#F7F6F0" />
          <circle cx="46" cy="18" r="6" fill="#F28C28" />
        </svg>
      </Box>
      <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', letterSpacing: '-0.02em' }}>
        Smart<Box component="span" sx={{ color: 'primary.main' }}>Nest</Box>
      </Typography>
    </Stack>
  );
}

function OptionCard({ icon, title, description, selected, onClick }: { icon: React.ReactNode; title: string; description: string; selected?: boolean; onClick: () => void }) {
  return (
    <Card sx={{ boxShadow: 'none', borderColor: selected ? 'primary.main' : undefined, borderWidth: selected ? 2 : 1 }}>
      <CardActionArea onClick={onClick} sx={{ p: 2, height: '100%' }} aria-pressed={selected}>
        <Box sx={{ width: 40, height: 40, borderRadius: '12px', bgcolor: 'sage.main', color: 'primary.dark', display: 'grid', placeItems: 'center', mb: 1.25 }} aria-hidden>
          {icon}
        </Box>
        <Typography variant="h5" component="h3">
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {description}
        </Typography>
      </CardActionArea>
    </Card>
  );
}

export default function OnboardingPage() {
  const [params] = useSearchParams();
  const isNew = params.get('new') === '1';
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const homes = useHomesQuery();
  const currentHomeId = useAppSelector((s) => s.ui.currentHomeId);
  const [logout] = useLogoutMutation();

  const [step, setStep] = useState(0);
  const [homeId, setHomeId] = useState<string | null>(null);
  const home = useHomeQuery(homeId ?? '', { skip: !homeId });

  // Resume onboarding for an owner whose current home isn't finished yet
  const [resumed, setResumed] = useState(false);
  useEffect(() => {
    if (resumed || isNew || !homes.data) return;
    const current = homes.data.homes.find((h) => h.id === currentHomeId) ?? homes.data.homes[0];
    if (current && current.role === 'owner') {
      setHomeId(current.id);
      setResumed(true);
    } else setResumed(true);
  }, [homes.data, currentHomeId, isNew, resumed]);
  useEffect(() => {
    // An already-onboarded home with ?new absent: nothing to do here
    if (home.data?.home.onboardingCompleted && !isNew && step === 0) navigate('/', { replace: true });
  }, [home.data, isNew, step, navigate]);
  useEffect(() => {
    if (homeId && home.data && !home.data.home.onboardingCompleted && step < 2 && resumed && !isNew) setStep(2);
    // only on first resolution
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home.data?.home.id]);

  const hasOtherHomes = (homes.data?.homes.length ?? 0) > 0;
  const go = (n: number) => setStep(n);

  // Shared state across later steps
  const [haIntegration, setHaIntegration] = useState<IntegrationDto | null>(null);
  const [haDiscovered, setHaDiscovered] = useState<DiscoveredDeviceDto[] | null>(null);
  const [demoAdded, setDemoAdded] = useState(false);
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: { xs: 2, md: 4 }, py: 2 }}>
        <Logo />
        <Stack direction="row" spacing={1}>
          {hasOtherHomes && isNew && (
            <Button component={RouterLink} to="/" startIcon={<ArrowLeft size={16} />}>
              Back to app
            </Button>
          )}
          <Button
            color="inherit"
            startIcon={<LogOut size={16} />}
            onClick={async () => {
              await logout().unwrap().catch(() => undefined);
              dispatch(resetLive());
              dispatch(api.util.resetApiState());
              navigate('/login');
            }}
          >
            Sign out
          </Button>
        </Stack>
      </Stack>

      <Box component="main" sx={{ flex: 1, display: 'flex', justifyContent: 'center', px: 2, pb: 6 }}>
        <Box sx={{ width: '100%', maxWidth: 780 }}>
          <Box sx={{ mb: 2 }} aria-live="polite">
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.75 }}>
              <Typography variant="caption">
                Step {step + 1} of {STEPS.length}
              </Typography>
              <Typography variant="caption" fontWeight={600}>
                {STEPS[step]}
              </Typography>
            </Stack>
            <LinearProgress variant="determinate" value={((step + 1) / STEPS.length) * 100} aria-label="Setup progress" />
          </Box>

          <Card sx={{ p: { xs: 2.5, sm: 4 } }}>
            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                {step === 0 && <WelcomeStep onNext={() => go(1)} />}
                {step === 1 && (
                  <HomeStep
                    onCreated={(id) => {
                      setHomeId(id);
                      dispatch(setCurrentHome(id));
                      go(2);
                    }}
                    onBack={() => go(0)}
                  />
                )}
                {step === 2 && homeId && (
                  <ConnectStep
                    homeId={homeId}
                    haIntegration={haIntegration}
                    demoAdded={demoAdded}
                    onHaConnected={(i, d) => {
                      setHaIntegration(i);
                      setHaDiscovered(d);
                    }}
                    onDemoAdded={() => setDemoAdded(true)}
                    onNext={() => go(3)}
                  />
                )}
                {step === 3 && homeId && <RoomsStep homeId={homeId} onBack={() => go(2)} onNext={() => go(4)} />}
                {step === 4 && homeId && (
                  <DevicesStep
                    homeId={homeId}
                    haIntegration={haIntegration}
                    haDiscovered={haDiscovered}
                    setHaDiscovered={setHaDiscovered}
                    demoAdded={demoAdded}
                    importResults={importResults}
                    onImported={setImportResults}
                    onBack={() => go(3)}
                    onNext={() => go(5)}
                  />
                )}
                {step === 5 && homeId && <FinishStep homeId={homeId} homeName={home.data?.home.name ?? 'your home'} />}
                {step >= 2 && !homeId && (
                  <Alert severity="warning" action={<Button onClick={() => go(1)}>Create a home</Button>}>
                    Create or choose a home first.
                  </Alert>
                )}
              </motion.div>
            </AnimatePresence>
          </Card>
        </Box>
      </Box>
    </Box>
  );
}

// ─── Steps ────────────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <Stack spacing={3} alignItems="flex-start">
      <Box sx={{ width: 64, height: 64, borderRadius: '20px', background: `linear-gradient(150deg, ${tokens.color.primary}, ${tokens.color.primaryDeep})`, color: '#fff', display: 'grid', placeItems: 'center' }} aria-hidden>
        <Sparkles size={30} />
      </Box>
      <Box>
        <Typography variant="h1" component="h1">
          Welcome to SmartNest
        </Typography>
        <Typography variant="h4" component="p" color="primary.main" sx={{ mt: 1 }}>
          Your entire home. One intelligent control centre.
        </Typography>
      </Box>
      <Typography color="text.secondary">
        In a few short steps you'll set up your home, connect the system that runs your devices (such as Home Assistant), add rooms and import devices. Every step
        except creating a home can be skipped, and you can explore a fully simulated demo home without any hardware.
      </Typography>
      <Box component="ul" sx={{ pl: 2.5, m: 0, color: 'text.secondary', '& li': { mb: 0.5 } }}>
        <li>Commands are only shown as successful once the device confirms them.</li>
        <li>Integration tokens are encrypted on the server and never sent back to your browser.</li>
        <li>Demo data is always clearly labelled.</li>
      </Box>
      <Button variant="contained" size="large" endIcon={<ArrowRight size={18} />} onClick={onNext} autoFocus>
        Get started
      </Button>
    </Stack>
  );
}

function HomeStep({ onCreated, onBack }: { onCreated: (homeId: string) => void; onBack: () => void }) {
  const [mode, setMode] = useState<'create' | 'join' | 'demo'>('create');
  const [createHome, createState] = useCreateHomeMutation();
  const [createDemo, demoState] = useCreateDemoHomeMutation();
  const [invite, setInvite] = useState('');
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const timezones = useMemo(allTimezones, []);
  const { register, handleSubmit, control, formState } = useForm<HomeForm>({
    resolver: zodResolver(homeFormSchema),
    defaultValues: { name: '', timezone: browserTimezone(), temperatureUnit: 'C' },
  });

  const inviteToken = (() => {
    const v = invite.trim();
    if (!v) return '';
    try {
      return new URL(v).searchParams.get('token') ?? '';
    } catch {
      return v.includes('token=') ? (v.split('token=')[1]?.split('&')[0] ?? '') : v;
    }
  })();

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h2" component="h1">
          Set up your home
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Create a new home, join one you've been invited to, or explore a demo.
        </Typography>
      </Box>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' } }} role="radiogroup" aria-label="How do you want to start?">
        <OptionCard icon={<Home size={20} />} title="Create a home" description="Start fresh and connect your own devices." selected={mode === 'create'} onClick={() => setMode('create')} />
        <OptionCard icon={<Users size={20} />} title="Join a home" description="Use an invitation from a household member." selected={mode === 'join'} onClick={() => setMode('join')} />
        <OptionCard icon={<FlaskConical size={20} />} title="Explore demo mode" description="A simulated home — no hardware needed." selected={mode === 'demo'} onClick={() => setMode('demo')} />
      </Box>

      {mode === 'create' && (
        <form
          noValidate
          onSubmit={handleSubmit(async (v) => {
            const r = await createHome(v).unwrap().catch(() => null);
            if (r) onCreated(r.home.id);
          })}
        >
          <Stack spacing={2}>
            {createState.error && <Alert severity="error">{toApiError(createState.error).message}</Alert>}
            <TextField label="Home name" placeholder="e.g. Maple House" autoFocus {...register('name')} error={!!formState.errors.name} helperText={formState.errors.name?.message} />
            <Controller
              control={control}
              name="timezone"
              render={({ field }) => (
                <Autocomplete
                  options={timezones}
                  value={field.value}
                  onChange={(_, v) => field.onChange(v ?? '')}
                  disableClearable
                  renderInput={(p) => <TextField {...p} label="Timezone" error={!!formState.errors.timezone} helperText={formState.errors.timezone?.message ?? 'Used for schedules, sunrise/sunset and activity times.'} />}
                />
              )}
            />
            <Controller
              control={control}
              name="temperatureUnit"
              render={({ field }) => (
                <Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }} id="temp-unit-label">
                    Temperature unit
                  </Typography>
                  <ToggleButtonGroup exclusive size="small" value={field.value} onChange={(_, v) => v && field.onChange(v)} aria-labelledby="temp-unit-label">
                    <ToggleButton value="C">Celsius (°C)</ToggleButton>
                    <ToggleButton value="F">Fahrenheit (°F)</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
              )}
            />
            <Stack direction="row" justifyContent="space-between">
              <Button startIcon={<ArrowLeft size={16} />} onClick={onBack}>
                Back
              </Button>
              <Button type="submit" variant="contained" disabled={createState.isLoading} endIcon={createState.isLoading ? <CircularProgress size={16} color="inherit" /> : <ArrowRight size={16} />}>
                Create home
              </Button>
            </Stack>
          </Stack>
        </form>
      )}

      {mode === 'join' && (
        <Stack spacing={2}>
          <Typography color="text.secondary">Paste the invitation link you received. You'll need to be signed in with the email address it was sent to.</Typography>
          <TextField label="Invitation link or code" value={invite} onChange={(e) => setInvite(e.target.value)} autoFocus />
          <Stack direction="row" justifyContent="space-between">
            <Button startIcon={<ArrowLeft size={16} />} onClick={onBack}>
              Back
            </Button>
            <Button variant="contained" disabled={inviteToken.length < 10} onClick={() => navigate(`/invite?token=${encodeURIComponent(inviteToken)}`)}>
              Review invitation
            </Button>
          </Stack>
        </Stack>
      )}

      {mode === 'demo' && (
        <Stack spacing={2}>
          <Alert severity="info" icon={<FlaskConical size={18} />}>
            SmartNest will create a separate <strong>Demo Home</strong> with simulated rooms, lights, climate, locks, cameras, sensors, scenes and automations. It's
            labelled as demo data everywhere, nothing physical is controlled, and no real notifications are sent. Some devices deliberately simulate being offline or
            unresponsive so you can see how failures are handled.
          </Alert>
          {demoState.error && <Alert severity="error">{toApiError(demoState.error).message}</Alert>}
          <Stack direction="row" justifyContent="space-between">
            <Button startIcon={<ArrowLeft size={16} />} onClick={onBack}>
              Back
            </Button>
            <Button
              variant="contained"
              disabled={demoState.isLoading}
              startIcon={demoState.isLoading ? <CircularProgress size={16} color="inherit" /> : <FlaskConical size={16} />}
              onClick={async () => {
                const r = await createDemo({ timezone: browserTimezone() }).unwrap().catch(() => null);
                if (!r) return;
                dispatch(resetLive());
                dispatch(api.util.resetApiState());
                dispatch(setCurrentHome(r.home.id));
                navigate('/', { replace: true });
              }}
            >
              {demoState.isLoading ? 'Building your demo home…' : 'Explore the demo home'}
            </Button>
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}

function ConnectStep({
  homeId, haIntegration, demoAdded, onHaConnected, onDemoAdded, onNext,
}: {
  homeId: string;
  haIntegration: IntegrationDto | null;
  demoAdded: boolean;
  onHaConnected: (i: IntegrationDto, d: DiscoveredDeviceDto[]) => void;
  onDemoAdded: () => void;
  onNext: () => void;
}) {
  const [choice, setChoice] = useState<'ha' | 'demo' | 'other' | null>(haIntegration ? 'ha' : demoAdded ? 'demo' : null);
  const [addDemo, demoState] = useAddDemoIntegrationMutation();
  const viaHa = (['mqtt', 'matter', 'zigbee_zwave', 'onvif', 'manufacturer'] as const).map((t) => INTEGRATIONS[t]);
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h2" component="h1">
          Connect your devices
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          SmartNest controls devices through documented integrations. Choose how to connect, or skip and do it later from Integrations.
        </Typography>
      </Box>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' } }}>
        <OptionCard icon={<KeyRound size={20} />} title="Home Assistant" description="Recommended. Connect with a long-lived access token." selected={choice === 'ha'} onClick={() => setChoice('ha')} />
        <OptionCard icon={<FlaskConical size={20} />} title="Demo devices" description="Add simulated, clearly labelled devices to this home." selected={choice === 'demo'} onClick={() => setChoice('demo')} />
        <OptionCard icon={<Radar size={20} />} title="Other methods" description="MQTT, Matter, Zigbee, Z-Wave, cameras and vendor clouds." selected={choice === 'other'} onClick={() => setChoice('other')} />
      </Box>

      {choice === 'ha' &&
        (haIntegration ? (
          <Alert severity="success">
            Connected to <strong>{haIntegration.name}</strong>. You'll choose which devices to import in a moment.
          </Alert>
        ) : (
          <Box sx={{ maxWidth: 560 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              In Home Assistant, open your profile → Security → Long-lived access tokens, create a token named “SmartNest” and paste it below.
            </Typography>
            <HomeAssistantForm homeId={homeId} onConnected={(r) => onHaConnected(r.integration, r.discovered)} />
          </Box>
        ))}

      {choice === 'demo' &&
        (demoAdded ? (
          <Alert severity="success">Demo devices were added to this home, together with matching rooms, example scenes and automations. They're labelled as demo data.</Alert>
        ) : (
          <Stack spacing={2}>
            <Alert severity="info">
              This adds the demonstration integration to <em>this</em> home: simulated devices, demo rooms, example scenes and automations, all labelled as demo data.
            </Alert>
            {demoState.error && <Alert severity="error">{toApiError(demoState.error).message}</Alert>}
            <Button
              variant="contained"
              sx={{ alignSelf: 'flex-start' }}
              disabled={demoState.isLoading}
              startIcon={demoState.isLoading ? <CircularProgress size={16} color="inherit" /> : <FlaskConical size={16} />}
              onClick={async () => {
                const ok = await addDemo(homeId).unwrap().then(() => true).catch(() => false);
                if (ok) onDemoAdded();
              }}
            >
              {demoState.isLoading ? 'Adding demo devices…' : 'Add demo devices'}
            </Button>
          </Stack>
        ))}

      {choice === 'other' && (
        <Stack spacing={1.5}>
          {viaHa.map((d) => (
            <Box key={d.type} sx={{ p: 1.5, border: `1px solid ${tokens.color.border}`, borderRadius: `${tokens.radius.md}px` }}>
              <Typography fontWeight={700}>{d.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {d.summary}
              </Typography>
            </Box>
          ))}
          <Alert severity="info">Set these up in Home Assistant first, then connect Home Assistant here — their devices will appear in discovery.</Alert>
        </Stack>
      )}

      <Stack direction="row" justifyContent="flex-end" spacing={1}>
        {!haIntegration && !demoAdded && <Button onClick={onNext}>Skip for now</Button>}
        <Button variant="contained" endIcon={<ArrowRight size={16} />} onClick={onNext} disabled={!haIntegration && !demoAdded}>
          Continue
        </Button>
      </Stack>
    </Stack>
  );
}

function RoomsStep({ homeId, onBack, onNext }: { homeId: string; onBack: () => void; onNext: () => void }) {
  const rooms = useRoomsQuery(homeId);
  const [createRoom, createState] = useCreateRoomMutation();
  const [custom, setCustom] = useState('');
  const [icon, setIcon] = useState<string>('home');
  const [error, setError] = useState<string | null>(null);
  const existing = new Set(rooms.data?.rooms.map((r) => r.name.toLowerCase()));

  const add = async (name: string, iconName: string) => {
    setError(null);
    try {
      await createRoom({ homeId, name, icon: iconName }).unwrap();
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h2" component="h1">
          Add your rooms
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Rooms keep devices organised. Tap a suggestion to add it, or create your own. You can rename, reorder or delete rooms later.
        </Typography>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      <Box>
        <Typography variant="overline" color="text.secondary">
          Suggestions
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
          {DEFAULT_ROOM_SUGGESTIONS.map((r) => {
            const added = existing.has(r.name.toLowerCase());
            return (
              <Chip
                key={r.name}
                icon={added ? <Check size={14} /> : <AppIcon name={r.icon} size={14} />}
                label={r.name}
                color={added ? 'primary' : 'default'}
                variant={added ? 'filled' : 'outlined'}
                disabled={createState.isLoading && !added}
                onClick={added ? undefined : () => void add(r.name, r.icon)}
                aria-label={added ? `${r.name} added` : `Add ${r.name}`}
                sx={{ height: 34 }}
              />
            );
          })}
        </Stack>
      </Box>
      <Box>
        <Typography variant="overline" color="text.secondary">
          Custom room
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 0.5 }} alignItems={{ sm: 'flex-start' }}>
          <TextField size="small" label="Room name" value={custom} onChange={(e) => setCustom(e.target.value)} inputProps={{ maxLength: 60 }} sx={{ flex: 1 }} />
          <Button
            variant="outlined"
            startIcon={<Plus size={16} />}
            disabled={!custom.trim() || createState.isLoading}
            onClick={async () => {
              await add(custom.trim(), icon);
              setCustom('');
            }}
          >
            Add room
          </Button>
        </Stack>
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }} role="radiogroup" aria-label="Room icon">
          {ROOM_ICONS.map((n) => (
            <Box
              key={n}
              component="button"
              type="button"
              role="radio"
              aria-checked={icon === n}
              aria-label={`Icon ${n.replace(/-/g, ' ')}`}
              onClick={() => setIcon(n)}
              sx={{
                width: 38, height: 38, borderRadius: '10px', cursor: 'pointer', display: 'grid', placeItems: 'center',
                border: `2px solid ${icon === n ? tokens.color.primary : tokens.color.border}`, bgcolor: icon === n ? 'sage.main' : 'background.paper', color: 'primary.dark',
              }}
            >
              <AppIcon name={n} size={18} />
            </Box>
          ))}
        </Stack>
      </Box>
      {!!rooms.data?.rooms.length && (
        <Typography variant="body2" color="text.secondary" role="status">
          {rooms.data.rooms.length} room{rooms.data.rooms.length === 1 ? '' : 's'} in this home: {rooms.data.rooms.map((r) => r.name).join(', ')}
        </Typography>
      )}
      <Stack direction="row" justifyContent="space-between">
        <Button startIcon={<ArrowLeft size={16} />} onClick={onBack}>
          Back
        </Button>
        <Stack direction="row" spacing={1}>
          {!rooms.data?.rooms.length && <Button onClick={onNext}>Skip</Button>}
          <Button variant="contained" endIcon={<ArrowRight size={16} />} onClick={onNext} disabled={!rooms.data?.rooms.length}>
            Continue
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
}

function DevicesStep({
  homeId, haIntegration, haDiscovered, setHaDiscovered, demoAdded, importResults, onImported, onBack, onNext,
}: {
  homeId: string;
  haIntegration: IntegrationDto | null;
  haDiscovered: DiscoveredDeviceDto[] | null;
  setHaDiscovered: (d: DiscoveredDeviceDto[]) => void;
  demoAdded: boolean;
  importResults: ImportResult[] | null;
  onImported: (r: ImportResult[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const counts = useDeviceCountsQuery(homeId);
  const [discover, discoverState] = useDiscoverMutation();
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h2" component="h1">
          Your first devices
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {haIntegration ? 'Choose which Home Assistant devices to bring into SmartNest and assign them to rooms.' : 'Devices come from the integrations you connect.'}
        </Typography>
      </Box>

      {haIntegration && !importResults && (
        haDiscovered ? (
          <DiscoveryReview homeId={homeId} integrationId={haIntegration.id} discovered={haDiscovered} onImported={onImported} />
        ) : (
          <Stack spacing={1.5} alignItems="flex-start">
            {discoverState.error && <Alert severity="error">{toApiError(discoverState.error).message}</Alert>}
            <Button
              variant="contained"
              startIcon={discoverState.isLoading ? <CircularProgress size={16} color="inherit" /> : <Radar size={16} />}
              disabled={discoverState.isLoading}
              onClick={async () => {
                const r = await discover({ homeId, integrationId: haIntegration.id }).unwrap().catch(() => null);
                if (r) setHaDiscovered(r.discovered);
              }}
            >
              Discover devices
            </Button>
          </Stack>
        )
      )}
      {importResults && <ImportResults results={importResults} discovered={haDiscovered ?? undefined} />}

      {!haIntegration && demoAdded && (
        <Alert severity="success" icon={<FlaskConical size={18} />}>
          {counts.data ? `${counts.data.total} demo devices` : 'Demo devices'} were imported and assigned to rooms. They're simulated and labelled as demo data.
        </Alert>
      )}
      {!haIntegration && !demoAdded && (
        <Alert severity="info">
          No integration is connected yet, so there are no devices to import. You can add devices any time from <strong>Integrations → Add integration</strong> or the
          “Quick action” button.
        </Alert>
      )}

      <Stack direction="row" justifyContent="space-between">
        <Button startIcon={<ArrowLeft size={16} />} onClick={onBack}>
          Back
        </Button>
        <Stack direction="row" spacing={1}>
          {haIntegration && !importResults && <Button onClick={onNext}>Skip</Button>}
          <Button variant="contained" endIcon={<ArrowRight size={16} />} onClick={onNext} disabled={!!haIntegration && !importResults}>
            Continue
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
}

function FinishStep({ homeId, homeName }: { homeId: string; homeName: string }) {
  const [complete, state] = useCompleteOnboardingMutation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  return (
    <Stack spacing={3} alignItems="flex-start">
      <Box sx={{ width: 64, height: 64, borderRadius: '50%', bgcolor: '#E3F0E7', color: 'success.main', display: 'grid', placeItems: 'center' }} aria-hidden>
        <Check size={32} />
      </Box>
      <Box>
        <Typography variant="h2" component="h1">
          {homeName} is ready
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Your dashboard shows device status, rooms, climate, cameras and recent activity. You can customise it, create scenes and build automations whenever you like.
        </Typography>
      </Box>
      {state.error && <Alert severity="error">{toApiError(state.error).message}</Alert>}
      <Button
        variant="contained"
        size="large"
        disabled={state.isLoading}
        endIcon={state.isLoading ? <CircularProgress size={16} color="inherit" /> : <ArrowRight size={18} />}
        onClick={async () => {
          const r = await complete(homeId).unwrap().catch(() => null);
          if (!r) return;
          dispatch(setCurrentHome(homeId));
          navigate('/', { replace: true });
        }}
      >
        Go to my dashboard
      </Button>
    </Stack>
  );
}
