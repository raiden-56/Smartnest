import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardActionArea, CircularProgress, Link, List, ListItem, ListItemIcon, ListItemText, Stack, Step, StepLabel, Stepper, Typography } from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, FlaskConical, Info, Radar } from 'lucide-react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { INTEGRATIONS, INTEGRATION_TYPES, type DiscoveredDeviceDto, type IntegrationDto, type IntegrationType } from '@smartnest/shared';
import { toApiError, useConnectDemoMutation, useDiscoverMutation, useIntegrationCatalogueQuery, useIntegrationQuery, useIntegrationsQuery, type ImportResult } from '../../api/api';
import { useHome } from '../../app/hooks';
import { pushToast, useAppDispatch } from '../../app/store';
import { ErrorState, ListSkeleton, PageHeader, PermissionDenied, SectionCard } from '../../components/common/States';
import { tokens } from '../../theme/theme';
import { DiscoveryReview, HomeAssistantForm, ImportResults } from './components';
import { SupportChip } from './IntegrationsPage';

const STEPS = ['Method', 'Requirements', 'Connect', 'Discover', 'Review & import', 'Results'];

export function RequirementsPanel({ type }: { type: IntegrationType }) {
  const def = INTEGRATIONS[type];
  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h5" component="h3" sx={{ mb: 1 }}>
          What you need
        </Typography>
        <List dense disablePadding>
          {def.requirements.map((r) => (
            <ListItem key={r} disableGutters sx={{ alignItems: 'flex-start' }}>
              <ListItemIcon sx={{ minWidth: 30, mt: 0.5, color: 'primary.main' }}>
                <CheckCircle2 size={16} />
              </ListItemIcon>
              <ListItemText primary={r} />
            </ListItem>
          ))}
        </List>
      </Box>
      <Box>
        <Typography variant="h5" component="h3" sx={{ mb: 1 }}>
          Steps
        </Typography>
        <Box component="ol" sx={{ pl: 3, m: 0, '& li': { mb: 0.75 } }}>
          {def.setupSteps.map((s) => (
            <li key={s}>
              <Typography variant="body2">{s}</Typography>
            </li>
          ))}
        </Box>
      </Box>
      {def.limitations.length > 0 && (
        <Alert severity="info" icon={<Info size={18} />}>
          <strong>Limitations</strong>
          <Box component="ul" sx={{ pl: 2, m: 0, mt: 0.5 }}>
            {def.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </Box>
        </Alert>
      )}
      {def.docsUrl && (
        <Link href={def.docsUrl} target="_blank" rel="noopener noreferrer" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          Official documentation <ExternalLink size={14} aria-hidden />
          <Box component="span" sx={{ position: 'absolute', left: -9999 }}>
            (opens in a new tab)
          </Box>
        </Link>
      )}
    </Stack>
  );
}

export default function AddIntegrationPage() {
  const { homeId, can } = useHome();
  const { type: typeParam } = useParams();
  const [params] = useSearchParams();
  const existingId = params.get('integrationId');
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const catalogue = useIntegrationCatalogueQuery();
  const existingList = useIntegrationsQuery(homeId);
  const existing = useIntegrationQuery({ homeId, integrationId: existingId ?? '' }, { skip: !existingId });
  const [connectDemo, demoState] = useConnectDemoMutation();
  const [discover, discoverState] = useDiscoverMutation();

  const initialType = typeParam && (INTEGRATION_TYPES as readonly string[]).includes(typeParam) ? (typeParam as IntegrationType) : null;
  const [type, setType] = useState<IntegrationType | null>(initialType);
  const [step, setStep] = useState(initialType ? 1 : 0);
  const [integration, setIntegration] = useState<IntegrationDto | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredDeviceDto[] | null>(null);
  const [results, setResults] = useState<ImportResult[] | null>(null);

  // Jump straight to discovery for an existing integration
  useEffect(() => {
    if (existing.data && !integration) {
      setIntegration(existing.data.integration);
      setType(existing.data.integration.type);
      setStep(3);
    }
  }, [existing.data, integration]);

  if (!can('integrations.manage')) return <PermissionDenied message="Only home owners and administrators can add integrations." />;

  const runDiscovery = async () => {
    if (!integration) return;
    try {
      const r = await discover({ homeId, integrationId: integration.id }).unwrap();
      setDiscovered(r.discovered);
      setStep(4);
    } catch {
      /* error shown inline */
    }
  };

  const haIntegration = existingList.data?.integrations.find((i) => i.type === 'home_assistant');
  const def = type ? INTEGRATIONS[type] : null;

  return (
    <>
      <PageHeader
        title={existingId ? `Discover devices${integration ? ` · ${integration.name}` : ''}` : 'Add an integration'}
        subtitle="Connect a supported system, review what it reports, and import only the devices you want."
        actions={
          <Button component={RouterLink} to="/integrations" startIcon={<ArrowLeft size={16} />}>
            Integrations
          </Button>
        }
      />
      <Stepper activeStep={step} alternativeLabel sx={{ mb: 3, '& .MuiStepLabel-label': { display: { xs: 'none', sm: 'block' }, fontSize: '0.8rem' } }} aria-label="Setup progress">
        {STEPS.map((s) => (
          <Step key={s}>
            <StepLabel>{s}</StepLabel>
          </Step>
        ))}
      </Stepper>
      <Typography variant="caption" component="p" sx={{ display: { xs: 'block', sm: 'none' }, mb: 2, textAlign: 'center' }} aria-live="polite">
        Step {step + 1} of {STEPS.length}: {STEPS[step]}
      </Typography>

      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}>
          {step === 0 && (
            <SectionCard title="1. Choose a connection method">
              {catalogue.isLoading ? (
                <ListSkeleton rows={4} />
              ) : catalogue.error ? (
                <ErrorState error={catalogue.error} onRetry={catalogue.refetch} />
              ) : (
                <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } }}>
                  {catalogue.data?.integrations.map((d) => (
                    <Card key={d.type} sx={{ boxShadow: 'none', borderColor: type === d.type ? 'primary.main' : undefined }}>
                      <CardActionArea
                        sx={{ p: 2, height: '100%' }}
                        onClick={() => {
                          setType(d.type);
                          setStep(1);
                        }}
                      >
                        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
                          <Typography variant="h5" component="h3">
                            {d.name}
                          </Typography>
                          <SupportChip level={d.supportLevel} />
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                          {d.summary}
                        </Typography>
                      </CardActionArea>
                    </Card>
                  ))}
                </Box>
              )}
            </SectionCard>
          )}

          {step === 1 && type && def && (
            <SectionCard title={`2. Before you start · ${def.name}`} action={<SupportChip level={def.supportLevel} />}>
              <RequirementsPanel type={type} />
              <Stack direction="row" justifyContent="space-between" sx={{ mt: 3 }}>
                <Button startIcon={<ArrowLeft size={16} />} onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button variant="contained" endIcon={<ArrowRight size={16} />} onClick={() => setStep(2)}>
                  Continue
                </Button>
              </Stack>
            </SectionCard>
          )}

          {step === 2 && type && def && (
            <SectionCard title={`3. Connect · ${def.name}`}>
              {type === 'home_assistant' && (
                <Box sx={{ maxWidth: 560 }}>
                  <HomeAssistantForm
                    homeId={homeId}
                    onConnected={(r) => {
                      setIntegration(r.integration);
                      setDiscovered(r.discovered);
                      dispatch(pushToast({ message: `Connected to ${r.integration.name}. ${r.discovered.length} devices found.`, severity: 'success' }));
                      setStep(4);
                    }}
                  />
                </Box>
              )}
              {type === 'demo' && (
                <Stack spacing={2} sx={{ maxWidth: 620 }}>
                  <Alert severity="info" icon={<FlaskConical size={18} />}>
                    The demonstration integration simulates devices. Everything it provides is labelled as demo data and nothing physical is controlled. If this home
                    already has a demo integration, it is reused.
                  </Alert>
                  {demoState.error && <Alert severity="error">{toApiError(demoState.error).message}</Alert>}
                  <Button
                    variant="contained"
                    sx={{ alignSelf: 'flex-start' }}
                    disabled={demoState.isLoading}
                    startIcon={demoState.isLoading ? <CircularProgress size={16} color="inherit" /> : <FlaskConical size={16} />}
                    onClick={async () => {
                      const r = await connectDemo(homeId).unwrap().catch(() => null);
                      if (r) {
                        setIntegration(r.integration);
                        setStep(3);
                      }
                    }}
                  >
                    {demoState.isLoading ? 'Starting simulation…' : 'Connect demonstration integration'}
                  </Button>
                </Stack>
              )}
              {type !== 'home_assistant' && type !== 'demo' && (
                <Stack spacing={2} sx={{ maxWidth: 640 }}>
                  <Alert severity="info">
                    {def.name} is not connected to SmartNest directly in this build. {def.summary} Once it is set up in Home Assistant, its devices appear when you
                    discover devices from your Home Assistant integration.
                  </Alert>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    {haIntegration ? (
                      <Button variant="contained" component={RouterLink} to={`/integrations/add?integrationId=${haIntegration.id}`} startIcon={<Radar size={16} />}>
                        Discover from {haIntegration.name}
                      </Button>
                    ) : (
                      <Button
                        variant="contained"
                        onClick={() => {
                          setType('home_assistant');
                          setStep(1);
                        }}
                      >
                        Connect Home Assistant
                      </Button>
                    )}
                    <Button onClick={() => setStep(0)}>Choose another method</Button>
                  </Stack>
                </Stack>
              )}
              {(type === 'home_assistant' || type === 'demo') && (
                <Button startIcon={<ArrowLeft size={16} />} onClick={() => setStep(1)} sx={{ mt: 2 }}>
                  Back
                </Button>
              )}
            </SectionCard>
          )}

          {step === 3 && (
            <SectionCard title="4. Discover devices">
              {!integration ? (
                existing.isLoading ? <ListSkeleton rows={2} /> : <ErrorState error={existing.error ?? new Error('Integration not found')} />
              ) : (
                <Stack spacing={2} sx={{ maxWidth: 640 }}>
                  <Typography color="text.secondary">
                    SmartNest will ask <strong>{integration.name}</strong> which devices it exposes. Nothing is scanned on your network and nothing is imported until you
                    choose. Discovery only lists devices; it does not give anyone permission to control them.
                  </Typography>
                  {discoverState.error && <Alert severity="error">{toApiError(discoverState.error).message}</Alert>}
                  <Button
                    variant="contained"
                    sx={{ alignSelf: 'flex-start' }}
                    onClick={() => void runDiscovery()}
                    disabled={discoverState.isLoading}
                    startIcon={discoverState.isLoading ? <CircularProgress size={16} color="inherit" /> : <Radar size={16} />}
                  >
                    {discoverState.isLoading ? 'Discovering…' : 'Discover devices'}
                  </Button>
                </Stack>
              )}
            </SectionCard>
          )}

          {step === 4 && integration && discovered && (
            <SectionCard title={`5. Review devices from ${integration.name}`}>
              <DiscoveryReview
                homeId={homeId}
                integrationId={integration.id}
                discovered={discovered}
                onImported={(r) => {
                  setResults(r);
                  setStep(5);
                }}
              />
            </SectionCard>
          )}

          {step === 5 && results && (
            <SectionCard title="6. Import and connectivity test results">
              <ImportResults results={results} discovered={discovered ?? undefined} />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 3 }}>
                <Button variant="contained" onClick={() => navigate('/devices')}>
                  Go to devices
                </Button>
                <Button variant="outlined" onClick={() => navigate('/rooms')}>
                  Organise rooms
                </Button>
                <Button
                  onClick={() => {
                    setResults(null);
                    void runDiscovery();
                  }}
                >
                  Import more devices
                </Button>
                {integration && <Button component={RouterLink} to={`/integrations/${integration.id}`}>View integration</Button>}
              </Stack>
            </SectionCard>
          )}
        </motion.div>
      </AnimatePresence>
      <Box sx={{ height: tokens.radius.md }} />
    </>
  );
}
