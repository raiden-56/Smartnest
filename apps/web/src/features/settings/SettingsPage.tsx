import { Box, Tab, Tabs } from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import type { Permission } from '@smartnest/shared';
import { useHome } from '../../app/hooks';
import { PageHeader } from '../../components/common/States';
import { NotificationsTab, PreferencesTab, ProfileTab } from './AccountTabs';
import { AuditTab, HomeTab, MembersTab, PrivacyTab } from './HomeTabs';

const TABS: { id: string; label: string; permission?: Permission; el: () => JSX.Element }[] = [
  { id: 'profile', label: 'Profile & security', el: ProfileTab },
  { id: 'preferences', label: 'Preferences', el: PreferencesTab },
  { id: 'home', label: 'Home', el: HomeTab },
  { id: 'members', label: 'Members', permission: 'members.view', el: MembersTab },
  { id: 'notifications', label: 'Notifications', el: NotificationsTab },
  { id: 'privacy', label: 'Privacy & data', el: PrivacyTab },
  { id: 'audit', label: 'Audit log', permission: 'audit.view', el: AuditTab },
];

export default function SettingsPage() {
  const { tab = 'profile' } = useParams();
  const { can } = useHome();
  const navigate = useNavigate();
  const visible = TABS.filter((t) => !t.permission || can(t.permission));
  const current = visible.find((t) => t.id === tab) ?? visible[0]!;
  const Current = current.el;
  return (
    <>
      <PageHeader title="Settings" />
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={current.id} onChange={(_, v) => navigate(`/settings/${v}`)} variant="scrollable" allowScrollButtonsMobile aria-label="Settings sections">
          {visible.map((t) => (
            <Tab key={t.id} value={t.id} label={t.label} id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} />
          ))}
        </Tabs>
      </Box>
      <Box role="tabpanel" id={`panel-${current.id}`} aria-labelledby={`tab-${current.id}`}>
        <Current />
      </Box>
    </>
  );
}
