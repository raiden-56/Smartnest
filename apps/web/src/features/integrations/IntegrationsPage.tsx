import { Box, Button, Card, CardActionArea, Chip, Stack, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { BookOpen, ChevronRight, Plus } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { SUPPORT_LEVEL_LABELS, type SupportLevel } from '@smartnest/shared';
import { useIntegrationCatalogueQuery, useIntegrationsQuery } from '../../api/api';
import { timeAgo, useHome } from '../../app/hooks';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, SectionCard } from '../../components/common/States';
import { DemoBadge } from '../../components/common/StatusBadge';
import { tokens } from '../../theme/theme';
import { IntegrationStatusChip } from './components';

export function SupportChip({ level }: { level: SupportLevel }) {
  const sx =
    level === 'supported'
      ? { bgcolor: '#E3F0E7', color: tokens.color.success }
      : level === 'via_home_assistant'
        ? { bgcolor: tokens.color.sage, color: tokens.color.primaryDeep }
        : { bgcolor: tokens.color.disabled, color: tokens.color.textSecondary };
  return <Chip size="small" label={SUPPORT_LEVEL_LABELS[level]} sx={{ ...sx, height: 22, fontSize: '0.72rem' }} />;
}

export default function IntegrationsPage() {
  const { homeId, can } = useHome();
  const list = useIntegrationsQuery(homeId);
  const catalogue = useIntegrationCatalogueQuery();
  const manage = can('integrations.manage');

  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Connections SmartNest uses to discover, monitor and control your devices."
        actions={
          <>
            <Button component={RouterLink} to="/devices/catalogue" startIcon={<BookOpen size={16} />} variant="outlined">
              Device catalogue
            </Button>
            {manage && (
              <Button component={RouterLink} to="/integrations/add" startIcon={<Plus size={18} />} variant="contained">
                Add integration
              </Button>
            )}
          </>
        }
      />

      <Stack spacing={3}>
        <SectionCard title="Connected">
          {list.isLoading ? (
            <ListSkeleton rows={3} height={72} />
          ) : list.error ? (
            <ErrorState error={list.error} onRetry={list.refetch} title="Could not load integrations" />
          ) : !list.data?.integrations.length ? (
            <EmptyState
              icon={<Plus size={24} />}
              title="No integrations yet"
              description="Connect Home Assistant to bring in your real devices, or add the demonstration integration to explore SmartNest without hardware."
              action={
                manage && (
                  <Button component={RouterLink} to="/integrations/add" variant="contained">
                    Add integration
                  </Button>
                )
              }
            />
          ) : (
            <Stack spacing={1.5}>
              {list.data.integrations.map((i, idx) => (
                <motion.div key={i.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: idx * 0.04 }}>
                  <Card sx={{ boxShadow: 'none' }}>
                    <CardActionArea component={RouterLink} to={`/integrations/${i.id}`} sx={{ p: 2 }}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Typography variant="h5" component="h3">
                              {i.name}
                            </Typography>
                            <IntegrationStatusChip status={i.status} />
                            {i.isDemo && <DemoBadge compact />}
                          </Stack>
                          {i.statusMessage && i.status !== 'connected' && (
                            <Typography variant="body2" color={i.status === 'error' || i.status === 'auth_failed' ? 'error.main' : 'text.secondary'} sx={{ mt: 0.5 }}>
                              {i.statusMessage}
                            </Typography>
                          )}
                          <Typography variant="caption" component="p" sx={{ mt: 0.5 }} noWrap>
                            {i.baseUrl ? `${i.baseUrl} · ` : ''}Last sync {timeAgo(i.lastSyncAt)}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={3} alignItems="center">
                          <Box>
                            <Typography fontWeight={700}>{i.deviceCount}</Typography>
                            <Typography variant="caption">devices</Typography>
                          </Box>
                          <Box>
                            <Typography fontWeight={700}>{i.discoveredNotImported}</Typography>
                            <Typography variant="caption">not imported</Typography>
                          </Box>
                          <ChevronRight size={18} aria-hidden />
                        </Stack>
                      </Stack>
                    </CardActionArea>
                  </Card>
                </motion.div>
              ))}
            </Stack>
          )}
        </SectionCard>

        <SectionCard title="Connection methods">
          <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
            SmartNest only talks to devices through documented integrations. Methods marked “Via Home Assistant” are configured in Home Assistant and then appear through
            your Home Assistant connection.
          </Typography>
          {catalogue.isLoading ? (
            <ListSkeleton rows={4} />
          ) : catalogue.error ? (
            <ErrorState error={catalogue.error} onRetry={catalogue.refetch} />
          ) : (
            <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' } }}>
              {catalogue.data?.integrations.map((d) => (
                <Card key={d.type} sx={{ p: 2, boxShadow: 'none', display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                    <Typography variant="h5" component="h3">
                      {d.name}
                    </Typography>
                    <SupportChip level={d.supportLevel} />
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                    {d.summary}
                  </Typography>
                  {manage && (
                    <Button component={RouterLink} to={`/integrations/add/${d.type}`} size="small" sx={{ alignSelf: 'flex-start' }} endIcon={<ChevronRight size={14} />}>
                      {d.supportLevel === 'supported' ? 'Set up' : 'How to connect'}
                    </Button>
                  )}
                </Card>
              ))}
            </Box>
          )}
        </SectionCard>
      </Stack>
    </>
  );
}
