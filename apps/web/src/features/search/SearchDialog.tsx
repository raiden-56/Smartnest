import { useEffect, useMemo, useState } from 'react';
import { Box, Dialog, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader, TextField, Typography } from '@mui/material';
import { Activity, Bot, Plug, Search, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSearchQuery } from '../../api/api';
import { useHome } from '../../app/hooks';
import { setSearchOpen, useAppDispatch, useAppSelector } from '../../app/store';
import { AppIcon } from '../../components/common/AppIcon';
import { CATEGORY_INFO } from '@smartnest/shared';

interface Result {
  group: string;
  id: string;
  label: string;
  secondary?: string;
  icon: React.ReactNode;
  to: string;
}

/** Global search across devices, rooms, scenes, automations, integrations and activity (Ctrl/⌘+K). */
export function SearchDialog() {
  const open = useAppSelector((s) => s.ui.searchOpen);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { homeId } = useHome();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 180);
    return () => window.clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!open) {
      setQ('');
      setDebounced('');
    }
  }, [open]);

  const res = useSearchQuery({ homeId, q: debounced }, { skip: !open || debounced.length < 1 });
  const results: Result[] = useMemo(() => {
    const d = res.data;
    if (!d) return [];
    return [
      ...d.devices.map((x) => ({ group: 'Devices', id: x.id, label: x.name, secondary: `${x.roomName ?? 'No room'} · ${CATEGORY_INFO[x.category]?.label ?? x.category}`, icon: <AppIcon name={CATEGORY_INFO[x.category]?.icon ?? 'box'} size={18} />, to: `/devices/${x.id}` })),
      ...d.rooms.map((x) => ({ group: 'Rooms', id: x.id, label: x.name, icon: <AppIcon name={x.icon} size={18} />, to: `/rooms/${x.id}` })),
      ...d.scenes.map((x) => ({ group: 'Scenes', id: x.id, label: x.name, icon: <Sparkles size={18} />, to: `/scenes?highlight=${x.id}` })),
      ...d.automations.map((x) => ({ group: 'Automations', id: x.id, label: x.name, secondary: x.enabled ? 'Enabled' : 'Disabled', icon: <Bot size={18} />, to: `/automations/${x.id}` })),
      ...d.integrations.map((x) => ({ group: 'Integrations', id: x.id, label: x.name, icon: <Plug size={18} />, to: `/integrations/${x.id}` })),
      ...d.activity.map((x) => ({ group: 'Activity', id: x.id, label: x.title, secondary: new Date(x.createdAt).toLocaleString(), icon: <Activity size={18} />, to: `/activity?q=${encodeURIComponent(x.title)}` })),
    ];
  }, [res.data]);

  useEffect(() => setActive(0), [results.length]);

  const close = () => dispatch(setSearchOpen(false));
  const go = (r: Result) => {
    close();
    navigate(r.to);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      go(results[active]);
    }
  };

  let lastGroup = '';
  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm" PaperProps={{ sx: { alignSelf: 'flex-start', mt: { xs: 2, sm: 10 } } }} aria-label="Search">
      <Box sx={{ p: 2 }}>
        <TextField
          autoFocus
          placeholder="Search devices, rooms, scenes, automations…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          inputProps={{
            'aria-label': 'Search',
            role: 'combobox',
            'aria-expanded': results.length > 0,
            'aria-controls': 'search-results',
            'aria-activedescendant': results[active] ? `search-${results[active]!.group}-${results[active]!.id}` : undefined,
          }}
          InputProps={{ startAdornment: (<InputAdornment position="start"><Search size={18} /></InputAdornment>) }}
        />
      </Box>
      <Box sx={{ maxHeight: 420, overflowY: 'auto', pb: 1 }}>
        {debounced && res.isFetching && !results.length && (
          <Typography color="text.secondary" sx={{ px: 3, pb: 2 }}>
            Searching…
          </Typography>
        )}
        {debounced && !res.isFetching && res.data && !results.length && (
          <Box sx={{ px: 3, pb: 3 }}>
            <Typography fontWeight={600}>No matches for “{debounced}”.</Typography>
            <Typography variant="body2" color="text.secondary">
              Try a device name, room, manufacturer, scene or automation.
            </Typography>
          </Box>
        )}
        {!debounced && (
          <Typography color="text.secondary" variant="body2" sx={{ px: 3, pb: 2 }}>
            Use ↑ ↓ to move and Enter to open.
          </Typography>
        )}
        <List id="search-results" role="listbox" dense disablePadding>
          {results.map((r, i) => {
            const header = r.group !== lastGroup ? r.group : null;
            lastGroup = r.group;
            return (
              <Box key={`${r.group}-${r.id}`}>
                {header && <ListSubheader sx={{ lineHeight: '32px', bgcolor: 'background.paper' }}>{header}</ListSubheader>}
                <ListItemButton id={`search-${r.group}-${r.id}`} role="option" aria-selected={i === active} selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => go(r)} sx={{ mx: 1, borderRadius: 2 }}>
                  <ListItemIcon sx={{ minWidth: 36, color: 'primary.main' }}>{r.icon}</ListItemIcon>
                  <ListItemText primary={r.label} secondary={r.secondary} />
                </ListItemButton>
              </Box>
            );
          })}
        </List>
      </Box>
    </Dialog>
  );
}
