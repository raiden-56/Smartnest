import type { ReactNode } from 'react';
import { Box, Card, Stack, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { Lightbulb, Lock, Thermometer } from 'lucide-react';
import { tokens } from '../../theme/theme';

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.05fr 1fr' }, bgcolor: 'background.default' }}>
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' }, flexDirection: 'column', justifyContent: 'space-between', p: 6, color: '#fff',
          background: `radial-gradient(circle at 80% 15%, rgba(242,140,40,0.35), transparent 40%), linear-gradient(160deg, ${tokens.color.primary}, ${tokens.color.primaryDeep})`,
        }}
      >
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box sx={{ width: 40, height: 40, borderRadius: '12px', bgcolor: 'rgba(255,255,255,0.14)', display: 'grid', placeItems: 'center' }} aria-hidden>
            <svg viewBox="0 0 64 64" width="26" height="26">
              <path d="M14 33 32 17l18 16v15a3 3 0 0 1-3 3H37V38H27v13H17a3 3 0 0 1-3-3Z" fill="#F7F6F0" />
              <circle cx="46" cy="18" r="6" fill="#F28C28" />
            </svg>
          </Box>
          <Typography sx={{ fontWeight: 800, fontSize: '1.3rem' }}>SmartNest</Typography>
        </Stack>
        <Box>
          <Typography sx={{ fontSize: '2.4rem', fontWeight: 750, lineHeight: 1.15, letterSpacing: '-0.02em', maxWidth: 460 }}>Your entire home. One intelligent control centre.</Typography>
          <Typography sx={{ mt: 2, opacity: 0.85, maxWidth: 440 }}>
            Monitor and control devices from Home Assistant and other supported integrations — with honest status, confirmed commands and privacy built in.
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} aria-hidden>
          {[
            { icon: Lightbulb, label: 'Living room', value: 'On · 72%' },
            { icon: Thermometer, label: 'Bedroom', value: '20.5°C' },
            { icon: Lock, label: 'Front door', value: 'Locked' },
          ].map((x, i) => (
            <motion.div key={x.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.08, duration: 0.25 }}>
              <Box sx={{ p: 2, borderRadius: `${tokens.radius.md}px`, bgcolor: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', minWidth: 130 }}>
                <x.icon size={20} />
                <Typography variant="caption" component="p" sx={{ color: 'rgba(255,255,255,0.75)', mt: 1 }}>
                  {x.label}
                </Typography>
                <Typography fontWeight={700}>{x.value}</Typography>
              </Box>
            </motion.div>
          ))}
        </Stack>
      </Box>
      <Box sx={{ display: 'grid', placeItems: 'center', p: { xs: 2, sm: 4 } }}>
        <Card component="main" sx={{ width: '100%', maxWidth: 440, p: { xs: 3, sm: 4.5 } }}>
          <Typography variant="h2" component="h1">
            {title}
          </Typography>
          {subtitle && (
            <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>
              {subtitle}
            </Typography>
          )}
          {children}
        </Card>
      </Box>
    </Box>
  );
}
