import { useMemo, useState } from 'react';
import { Alert, Box, Breadcrumbs, Card, Chip, InputAdornment, Link, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { Search } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { INTEGRATIONS, SUPPORT_LEVEL_LABELS } from '@smartnest/shared';
import { useDeviceCatalogueQuery } from '../../api/api';
import { AppIcon } from '../../components/common/AppIcon';
import { ErrorState, PageHeader, RoomCardsSkeleton } from '../../components/common/States';

const CAP_LABEL: Record<string, string> = {
  onOff: 'On/off', brightness: 'Brightness', colorRgb: 'Colour', colorTemperature: 'Colour temp', temperatureSetpoint: 'Setpoint', hvacMode: 'Mode', fanSpeed: 'Fan speed',
  swing: 'Swing', position: 'Position', lock: 'Lock', alarmPanel: 'Alarm', mediaPlayback: 'Playback', volume: 'Volume', mediaSource: 'Source', battery: 'Battery',
  power: 'Power', energy: 'Energy', motion: 'Motion', contact: 'Contact', safetyAlarm: 'Hazard', sensor: 'Measurements', cameraStream: 'Camera', ptz: 'PTZ',
  motionDetectionToggle: 'Motion detection', charging: 'Charging', vacuum: 'Cleaning', valve: 'Valve', customAction: 'Device actions',
};

/** Searchable catalogue of device categories and which integrations can provide them. */
export default function CataloguePage() {
  const q = useDeviceCatalogueQuery();
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!q.data) return [];
    if (!s) return q.data.categories;
    return q.data.categories
      .map((c) => ({ ...c, types: c.label.toLowerCase().includes(s) ? c.types : c.types.filter((t) => t.toLowerCase().includes(s)) }))
      .filter((c) => c.types.length || c.label.toLowerCase().includes(s));
  }, [q.data, search]);

  return (
    <>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link component={RouterLink} to="/devices" underline="hover" color="inherit">
          Devices
        </Link>
        <Typography color="text.primary">Catalogue</Typography>
      </Breadcrumbs>
      <PageHeader title="Device catalogue" subtitle="Device types SmartNest can represent, and the integrations that can provide them." />
      <Alert severity="info" sx={{ mb: 2.5 }}>
        This is a catalogue of device categories, not a promise that every model or feature is supported. What you can control depends on the capabilities your integration
        actually exposes for each device — SmartNest only shows controls for those.
      </Alert>
      <TextField
        placeholder="Search device types, e.g. thermostat, smart plug, doorbell"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        inputProps={{ 'aria-label': 'Search device catalogue' }}
        InputProps={{ startAdornment: (<InputAdornment position="start"><Search size={16} /></InputAdornment>) }}
        sx={{ mb: 2.5, maxWidth: 520 }}
      />
      {q.isLoading && <RoomCardsSkeleton count={8} />}
      {q.error && <ErrorState error={q.error} onRetry={q.refetch} />}
      {q.data && !filtered.length && <Typography color="text.secondary">No device types match “{search}”.</Typography>}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {filtered.map((c) => (
          <Card key={c.id} sx={{ p: 2.5 }}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
              <Box sx={{ width: 42, height: 42, borderRadius: '12px', bgcolor: 'sage.main', color: 'primary.dark', display: 'grid', placeItems: 'center' }} aria-hidden>
                <AppIcon name={c.icon} size={21} />
              </Box>
              <Typography variant="h4" component="h2">
                {c.label}
              </Typography>
            </Stack>
            <Box component="ul" sx={{ m: 0, pl: 2.25, mb: 1.5 }}>
              {c.types.map((t) => (
                <Typography component="li" variant="body2" key={t}>
                  {t}
                </Typography>
              ))}
            </Box>
            <Typography variant="overline" color="text.secondary">
              Typical capabilities
            </Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap gap={0.5} sx={{ mb: 1.5, mt: 0.25 }}>
              {c.typicalCapabilities.map((cap) => (
                <Chip key={cap} size="small" variant="outlined" label={CAP_LABEL[cap] ?? cap} />
              ))}
            </Stack>
            <Typography variant="overline" color="text.secondary">
              Available through
            </Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap gap={0.5} sx={{ mt: 0.25 }}>
              {c.supportedBy.map((t) => {
                const def = INTEGRATIONS[t];
                return (
                  <Tooltip key={t} title={`${SUPPORT_LEVEL_LABELS[def.supportLevel]}: ${def.summary}`}>
                    <Chip
                      size="small"
                      label={def.name}
                      sx={{ bgcolor: def.supportLevel === 'supported' ? '#E3F0E7' : def.supportLevel === 'via_home_assistant' ? 'sage.main' : 'disabledSurface', color: def.supportLevel === 'supported' ? 'success.main' : 'text.primary' }}
                    />
                  </Tooltip>
                );
              })}
            </Stack>
          </Card>
        ))}
      </Box>
    </>
  );
}
