import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useHomesQuery, useMeQuery } from '../api/api';
import { AppShell } from '../components/layout/AppShell';
import { ErrorState } from '../components/common/States';
import { setCurrentHome, useAppDispatch, useAppSelector } from './store';
import { useCurrentHome } from './hooks';

const LoginPage = lazy(() => import('../features/auth/LoginPage'));
const RegisterPage = lazy(() => import('../features/auth/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('../features/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('../features/auth/ResetPasswordPage'));
const AcceptInvitePage = lazy(() => import('../features/auth/AcceptInvitePage'));
const OnboardingPage = lazy(() => import('../features/onboarding/OnboardingPage'));
const OverviewPage = lazy(() => import('../features/overview/OverviewPage'));
const RoomsPage = lazy(() => import('../features/rooms/RoomsPage'));
const RoomDetailPage = lazy(() => import('../features/rooms/RoomDetailPage'));
const DevicesPage = lazy(() => import('../features/devices/DevicesPage'));
const DeviceDetailPage = lazy(() => import('../features/devices/DeviceDetailPage'));
const CataloguePage = lazy(() => import('../features/devices/CataloguePage'));
const CamerasPage = lazy(() => import('../features/cameras/CamerasPage'));
const CameraDetailPage = lazy(() => import('../features/cameras/CameraDetailPage'));
const AutomationsPage = lazy(() => import('../features/automations/AutomationsPage'));
const AutomationEditorPage = lazy(() => import('../features/automations/AutomationEditorPage'));
const AutomationDetailPage = lazy(() => import('../features/automations/AutomationDetailPage'));
const ScenesPage = lazy(() => import('../features/scenes/ScenesPage'));
const SceneEditorPage = lazy(() => import('../features/scenes/SceneEditorPage'));
const EnergyPage = lazy(() => import('../features/energy/EnergyPage'));
const NetworkPage = lazy(() => import('../features/network/NetworkPage'));
const ActivityPage = lazy(() => import('../features/activity/ActivityPage'));
const IntegrationsPage = lazy(() => import('../features/integrations/IntegrationsPage'));
const AddIntegrationPage = lazy(() => import('../features/integrations/AddIntegrationPage'));
const IntegrationDetailPage = lazy(() => import('../features/integrations/IntegrationDetailPage'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage'));

function FullPageSpinner() {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }} role="status" aria-label="Loading SmartNest">
      <CircularProgress />
    </Box>
  );
}

/** Requires a session; otherwise sends the user to /login and back afterwards. */
function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMeQuery();
  const location = useLocation();
  if (me.isLoading) return <FullPageSpinner />;
  if (me.isError) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

/** Ensures a home is selected; users without a home go to onboarding. */
function RequireHome({ children }: { children: ReactNode }) {
  const homes = useHomesQuery();
  const currentHomeId = useAppSelector((s) => s.ui.currentHomeId);
  const dispatch = useAppDispatch();
  const current = useCurrentHome();
  const list = homes.data?.homes;
  const valid = list?.some((h) => h.id === currentHomeId);

  useEffect(() => {
    if (list && list.length && !valid) dispatch(setCurrentHome(list[0]!.id));
  }, [list, valid, dispatch]);

  if (homes.isLoading) return <FullPageSpinner />;
  if (homes.isError) return <Box sx={{ p: 4 }}><ErrorState error={homes.error} onRetry={homes.refetch} title="Could not load your homes" /></Box>;
  if (!list?.length) return <Navigate to="/onboarding" replace />;
  if (!valid || current.isLoading || !current.home) return <FullPageSpinner />;
  if (!current.home.onboardingCompleted && current.home.role === 'owner') return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/invite" element={<RequireAuth><AcceptInvitePage /></RequireAuth>} />
        <Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
        <Route
          element={
            <RequireAuth>
              <RequireHome>
                <AppShell />
              </RequireHome>
            </RequireAuth>
          }
        >
          <Route index element={<OverviewPage />} />
          <Route path="rooms" element={<RoomsPage />} />
          <Route path="rooms/:roomId" element={<RoomDetailPage />} />
          <Route path="devices" element={<DevicesPage />} />
          <Route path="devices/catalogue" element={<CataloguePage />} />
          <Route path="devices/:deviceId" element={<DeviceDetailPage />} />
          <Route path="cameras" element={<CamerasPage />} />
          <Route path="cameras/:deviceId" element={<CameraDetailPage />} />
          <Route path="automations" element={<AutomationsPage />} />
          <Route path="automations/new" element={<AutomationEditorPage />} />
          <Route path="automations/:automationId/edit" element={<AutomationEditorPage />} />
          <Route path="automations/:automationId" element={<AutomationDetailPage />} />
          <Route path="scenes" element={<ScenesPage />} />
          <Route path="scenes/new" element={<SceneEditorPage />} />
          <Route path="scenes/:sceneId/edit" element={<SceneEditorPage />} />
          <Route path="energy" element={<EnergyPage />} />
          <Route path="network" element={<NetworkPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="integrations/add" element={<AddIntegrationPage />} />
          <Route path="integrations/add/:type" element={<AddIntegrationPage />} />
          <Route path="integrations/:integrationId" element={<IntegrationDetailPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/:tab" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
