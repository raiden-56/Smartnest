import { Suspense, useEffect, useRef, useState } from 'react';
import {
  Avatar, BottomNavigation, BottomNavigationAction, Box, Button, Chip, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText,
  ListSubheader, Menu, MenuItem, Paper, Stack, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { motion } from 'framer-motion';
import {
  Bot, Check, ChevronsLeft, ChevronsRight, ChevronDown, Home, LogOut, Menu as MenuIcon, MoreHorizontal, Plus, Search, Sofa, Sparkles, UserRound, Wifi, WifiOff,
} from 'lucide-react';
import { Link as RouterLink, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABELS } from '@smartnest/shared';
import { api, useHomesQuery, useLogoutMutation, useMeQuery, useScenesQuery } from '../../api/api';
import { useHome } from '../../app/hooks';
import { resetLive, setCurrentHome, setSearchOpen, toggleSidebar, useAppDispatch, useAppSelector } from '../../app/store';
import { useRealtime } from '../../realtime/useRealtime';
import { tokens } from '../../theme/theme';
import { DemoBadge } from '../common/StatusBadge';
import { DetailSkeleton } from '../common/States';
import { NotificationsButton } from '../../features/notifications/NotificationsButton';
import { SearchDialog } from '../../features/search/SearchDialog';
import { FeatureGuideDialog, HelpMenu, ProductTour, useTourAutoStart } from '../../features/help/ProductTour';
import { NAV } from './nav';

const SIDEBAR_W = 248;
const SIDEBAR_COLLAPSED_W = 76;

function Logo({ compact }: { compact?: boolean }) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center" component={RouterLink} to="/" sx={{ textDecoration: 'none', color: 'text.primary' }} aria-label="SmartNest home">
      <Box sx={{ width: 36, height: 36, borderRadius: '11px', bgcolor: 'primary.main', display: 'grid', placeItems: 'center', flexShrink: 0 }} aria-hidden>
        <svg viewBox="0 0 64 64" width="24" height="24">
          <path d="M14 33 32 17l18 16v15a3 3 0 0 1-3 3H37V38H27v13H17a3 3 0 0 1-3-3Z" fill="#F7F6F0" />
          <circle cx="46" cy="18" r="6" fill="#F28C28" />
        </svg>
      </Box>
      {!compact && (
        <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', letterSpacing: '-0.02em' }}>
          Smart<Box component="span" sx={{ color: 'primary.main' }}>Nest</Box>
        </Typography>
      )}
    </Stack>
  );
}

function NavList({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { can } = useHome();
  return (
    <List component="nav" aria-label="Main" sx={{ px: 1.25, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      {NAV.filter((n) => !n.permission || can(n.permission)).map((n) => (
        <Tooltip key={n.to} title={collapsed ? n.label : ''} placement="right">
          <ListItemButton
            component={NavLink}
            to={n.to}
            end={n.to === '/'}
            onClick={onNavigate}
            data-tour={`nav-${n.to}`}
            sx={{
              borderRadius: `${tokens.radius.sm + 2}px`, minHeight: 44, px: collapsed ? 1.75 : 1.5, color: 'text.secondary',
              '&.active': { bgcolor: 'primary.main', color: '#fff', '& .MuiListItemIcon-root': { color: '#fff' }, '&:hover': { bgcolor: 'primary.dark' } },
            }}
          >
            <ListItemIcon sx={{ minWidth: collapsed ? 0 : 36, color: 'inherit' }}>
              <n.icon size={20} aria-hidden />
            </ListItemIcon>
            {!collapsed && <ListItemText primary={n.label} primaryTypographyProps={{ fontWeight: 600, fontSize: '0.92rem' }} />}
          </ListItemButton>
        </Tooltip>
      ))}
    </List>
  );
}

function HomeSwitcher() {
  const { home } = useHome();
  const homes = useHomesQuery();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button
        onClick={(e) => setAnchor(e.currentTarget)}
        data-tour="home-switcher"
        endIcon={<ChevronDown size={16} />}
        startIcon={<Home size={18} />}
        sx={{ color: 'text.primary', bgcolor: 'background.paper', border: `1px solid ${tokens.color.border}`, maxWidth: { xs: 170, sm: 260 }, '& .MuiButton-startIcon': { color: 'primary.main' } }}
        aria-label={`Current home: ${home.name}. Switch home`}
        aria-haspopup="menu"
      >
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {home.name}
        </Box>
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <ListSubheader sx={{ lineHeight: '32px' }}>Your homes</ListSubheader>
        {homes.data?.homes.map((h) => (
          <MenuItem
            key={h.id}
            selected={h.id === home.id}
            onClick={() => {
              setAnchor(null);
              if (h.id !== home.id) {
                dispatch(resetLive());
                dispatch(setCurrentHome(h.id));
                dispatch(api.util.resetApiState());
                navigate('/');
              }
            }}
          >
            <ListItemIcon>{h.id === home.id ? <Check size={16} /> : <Home size={16} />}</ListItemIcon>
            <ListItemText primary={h.name} secondary={ROLE_LABELS[h.role]} />
            {h.isDemo && (
              <Box sx={{ ml: 1 }}>
                <DemoBadge compact />
              </Box>
            )}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem component={RouterLink} to="/onboarding?new=1" onClick={() => setAnchor(null)}>
          <ListItemIcon>
            <Plus size={16} />
          </ListItemIcon>
          Create or join a home
        </MenuItem>
      </Menu>
    </>
  );
}

function QuickActions() {
  const { homeId, can } = useHome();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const scenes = useScenesQuery(homeId, { skip: !anchor });
  const navigate = useNavigate();
  const go = (to: string) => {
    setAnchor(null);
    navigate(to);
  };
  const favs = scenes.data?.scenes.filter((s) => s.isFavourite).slice(0, 4) ?? [];
  return (
    <>
      <Button data-tour="quick-action" variant="contained" color="primary" startIcon={<Plus size={18} />} onClick={(e) => setAnchor(e.currentTarget)} aria-haspopup="menu" sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
        Quick action
      </Button>
      <IconButton data-tour="quick-action" aria-label="Quick actions" onClick={(e) => setAnchor(e.currentTarget)} sx={{ display: { xs: 'inline-flex', sm: 'none' }, bgcolor: 'primary.main', color: '#fff', '&:hover': { bgcolor: 'primary.dark' } }}>
        <Plus size={20} />
      </IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        {can('integrations.manage') && (
          <MenuItem onClick={() => go('/integrations/add')}>
            <ListItemIcon>
              <Plus size={16} />
            </ListItemIcon>
            Add device or integration
          </MenuItem>
        )}
        {can('rooms.manage') && (
          <MenuItem onClick={() => go('/rooms?new=1')}>
            <ListItemIcon>
              <Sofa size={16} />
            </ListItemIcon>
            Add room
          </MenuItem>
        )}
        {can('scenes.manage') && (
          <MenuItem onClick={() => go('/scenes/new')}>
            <ListItemIcon>
              <Sparkles size={16} />
            </ListItemIcon>
            Create scene
          </MenuItem>
        )}
        {can('automations.manage') && (
          <MenuItem onClick={() => go('/automations/new')}>
            <ListItemIcon>
              <Bot size={16} />
            </ListItemIcon>
            Create automation
          </MenuItem>
        )}
        {favs.length > 0 && <Divider />}
        {favs.length > 0 && <ListSubheader sx={{ lineHeight: '30px' }}>Favourite scenes</ListSubheader>}
        {favs.map((s) => (
          <MenuItem key={s.id} onClick={() => go(`/scenes?run=${s.id}`)}>
            <ListItemIcon>
              <Sparkles size={16} />
            </ListItemIcon>
            Run “{s.name}”
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function UserMenu() {
  const me = useMeQuery();
  const { home } = useHome();
  const [logout] = useLogoutMutation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const name = me.data?.user.name ?? '';
  return (
    <>
      <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label={`Account menu for ${name}`} aria-haspopup="menu">
        <Avatar sx={{ width: 34, height: 34, bgcolor: 'terracotta.main', fontSize: '0.9rem', fontWeight: 700 }}>{name.slice(0, 1).toUpperCase()}</Avatar>
      </IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Box sx={{ px: 2, py: 1 }}>
          <Typography fontWeight={700}>{name}</Typography>
          <Typography variant="caption">
            {me.data?.user.email} · {ROLE_LABELS[home.role]}
          </Typography>
        </Box>
        <Divider />
        <MenuItem component={RouterLink} to="/settings/profile" onClick={() => setAnchor(null)}>
          <ListItemIcon>
            <UserRound size={16} />
          </ListItemIcon>
          Profile & security
        </MenuItem>
        <MenuItem
          onClick={async () => {
            setAnchor(null);
            await logout().unwrap().catch(() => undefined);
            dispatch(resetLive());
            dispatch(api.util.resetApiState());
            navigate('/login');
          }}
        >
          <ListItemIcon>
            <LogOut size={16} />
          </ListItemIcon>
          Sign out
        </MenuItem>
      </Menu>
    </>
  );
}

function RealtimeIndicator() {
  const status = useAppSelector((s) => s.ui.realtime);
  const live = status === 'live';
  return (
    <Tooltip title={live ? 'Receiving live updates' : status === 'offline' ? 'Live updates stopped. Sign in again.' : 'Reconnecting to live updates… Values may be out of date.'}>
      <Chip
        data-tour="live"
        size="small"
        icon={live ? <Wifi size={14} /> : <WifiOff size={14} />}
        label={live ? 'Live' : status === 'connecting' ? 'Connecting' : 'Reconnecting'}
        sx={{ display: { xs: 'none', md: 'inline-flex' }, bgcolor: live ? '#E3F0E7' : '#F8EEDC', color: live ? 'success.main' : 'warning.dark', '& .MuiChip-icon': { color: 'inherit' } }}
        role="status"
      />
    </Tooltip>
  );
}

export function AppShell() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'));
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const collapsed = useAppSelector((s) => s.ui.sidebarCollapsed);
  const { homeId, home, can } = useHome();
  const dispatch = useAppDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const me = useMeQuery();
  useRealtime(homeId);
  useTourAutoStart(me.data?.user.id, location.pathname === '/');

  // Only the content area scrolls, so reset it (not the window) when the page changes.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        dispatch(setSearchOpen(true));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_W;
  const mobilePrimary = NAV.filter((n) => n.primaryMobile && (!n.permission || can(n.permission)));
  const activeMobile = mobilePrimary.findIndex((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)));

  return (
    // Fixed app frame: sidebar and top bar stay put, only <main> scrolls.
    <Box sx={{ display: 'flex', height: '100dvh', overflow: 'hidden', bgcolor: 'background.default' }}>
      <Box component="a" href="#main" sx={{ position: 'absolute', left: -9999, '&:focus': { left: 16, top: 16, zIndex: 2000, bgcolor: 'background.paper', p: 1.5, borderRadius: 2 } }}>
        Skip to content
      </Box>

      {/* Desktop / tablet sidebar */}
      {!isMobile && (
        <motion.aside
          animate={{ width: isDesktop ? sidebarWidth : SIDEBAR_COLLAPSED_W }}
          transition={{ duration: tokens.motion.base, ease: 'easeOut' }}
          style={{ flexShrink: 0, height: '100%', overflow: 'hidden', borderRight: `1px solid ${tokens.color.border}`, background: '#FBFAF6' }}
          aria-label="Sidebar"
        >
          <Stack sx={{ height: '100%', py: 2.5 }}>
            <Box sx={{ px: isDesktop && !collapsed ? 2.5 : 2, mb: 3 }}>
              <Logo compact={!isDesktop || collapsed} />
            </Box>
            <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
              <NavList collapsed={!isDesktop || collapsed} />
            </Box>
            {isDesktop && (
              <Box sx={{ px: 1.25 }}>
                <Button
                  fullWidth
                  onClick={() => dispatch(toggleSidebar())}
                  startIcon={collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
                  sx={{ justifyContent: collapsed ? 'center' : 'flex-start', color: 'text.secondary', '& .MuiButton-startIcon': { mr: collapsed ? 0 : 1 } }}
                  aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  aria-expanded={!collapsed}
                >
                  {!collapsed && 'Collapse'}
                </Button>
              </Box>
            )}
          </Stack>
        </motion.aside>
      )}

      <Box sx={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Top bar */}
        <Box component="header" sx={{ flexShrink: 0, zIndex: 10, bgcolor: 'background.default', borderBottom: `1px solid ${tokens.color.border}` }}>
          <Stack direction="row" alignItems="center" spacing={{ xs: 1, sm: 1.5 }} sx={{ px: { xs: 2, md: 3 }, py: 1.25, maxWidth: 1600, mx: 'auto' }}>
            {isMobile && (
              <IconButton aria-label="Open navigation menu" onClick={() => setDrawerOpen(true)} edge="start">
                <MenuIcon size={22} />
              </IconButton>
            )}
            <HomeSwitcher />
            {home.isDemo && (
              <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
                <DemoBadge />
              </Box>
            )}
            <Box sx={{ flex: 1 }} />
            <Button
              data-tour="search"
              onClick={() => dispatch(setSearchOpen(true))}
              startIcon={<Search size={17} />}
              sx={{ display: { xs: 'none', md: 'inline-flex' }, color: 'text.secondary', bgcolor: 'background.paper', border: `1px solid ${tokens.color.border}`, minWidth: 220, justifyContent: 'flex-start' }}
              aria-label="Search (Ctrl+K)"
            >
              Search…
              <Box component="kbd" sx={{ ml: 'auto', fontSize: '0.72rem', border: `1px solid ${tokens.color.border}`, borderRadius: 1, px: 0.75, fontFamily: 'inherit' }}>
                Ctrl K
              </Box>
            </Button>
            <IconButton data-tour="search" aria-label="Search" onClick={() => dispatch(setSearchOpen(true))} sx={{ display: { xs: 'inline-flex', md: 'none' } }}>
              <Search size={20} />
            </IconButton>
            <RealtimeIndicator />
            <Box data-tour="notifications" sx={{ display: 'inline-flex' }}>
              <NotificationsButton />
            </Box>
            <HelpMenu />
            <QuickActions />
            <UserMenu />
          </Stack>
        </Box>

        <Box component="main" id="main" ref={mainRef} tabIndex={-1} sx={{ flex: 1, minHeight: 0, position: 'relative', overflowY: 'auto', overflowX: 'hidden', outline: 'none' }}>
          <Box sx={{ px: { xs: 2, md: 3 }, pt: { xs: 2, md: 2.5 }, pb: { xs: 12, md: 4 }, width: '100%', maxWidth: 1600, mx: 'auto' }}>
            {/* Enter-only transition: never delays navigation and cannot get stuck behind a suspending lazy route */}
            <Suspense fallback={<DetailSkeleton />}>
              <motion.div key={location.pathname.split('/').slice(0, 3).join('/')} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: tokens.motion.fast }}>
                <Outlet />
              </motion.div>
            </Suspense>
          </Box>
        </Box>
      </Box>

      {/* Mobile bottom navigation + drawer for secondary destinations */}
      {isMobile && (
        <Paper component="nav" aria-label="Primary" sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20, borderTop: `1px solid ${tokens.color.border}`, borderRadius: 0, pb: 'env(safe-area-inset-bottom)' }}>
          <BottomNavigation showLabels value={activeMobile === -1 ? mobilePrimary.length : activeMobile} sx={{ height: 64 }}>
            {mobilePrimary.map((n) => (
              <BottomNavigationAction key={n.to} data-tour={`nav-${n.to}`} label={n.label} icon={<n.icon size={22} />} onClick={() => navigate(n.to)} sx={{ minWidth: 0, '&.Mui-selected': { color: 'primary.main' } }} />
            ))}
            <BottomNavigationAction label="More" icon={<MoreHorizontal size={22} />} onClick={() => setDrawerOpen(true)} sx={{ minWidth: 0 }} />
          </BottomNavigation>
        </Paper>
      )}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} PaperProps={{ sx: { width: 280, borderRadius: 0, py: 2 } }}>
        <Box sx={{ px: 2.5, mb: 2 }}>
          <Logo />
        </Box>
        <NavList onNavigate={() => setDrawerOpen(false)} />
      </Drawer>

      <SearchDialog />
      <FeatureGuideDialog />
      <ProductTour />
    </Box>
  );
}

