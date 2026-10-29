import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Snackbar, TextField, Typography } from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ShieldCheck, X } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { toApiError, useReauthMutation } from '../../api/api';
import { dismissToast, useAppDispatch, useAppSelector } from '../../app/store';
import { tokens } from '../../theme/theme';

// ─── Confirmation ─────────────────────────────────────────────────────────

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'default' | 'danger' | 'security';
  /** Require the user to type this text to enable the confirm button. */
  typeToConfirm?: string;
}

type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>;
type ReauthFn = () => Promise<boolean>;

const ConfirmCtx = createContext<ConfirmFn>(async () => false);
const ReauthCtx = createContext<ReauthFn>(async () => false);

export const useConfirm = () => useContext(ConfirmCtx);
export const useReauth = () => useContext(ReauthCtx);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [confirm, setConfirm] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState('');
  const [reauth, setReauth] = useState<{ resolve: (v: boolean) => void } | null>(null);
  const [password, setPassword] = useState('');
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [doReauth, { isLoading }] = useReauthMutation();
  const pwRef = useRef<HTMLInputElement>(null);

  const askConfirm = useCallback<ConfirmFn>((o) => new Promise((resolve) => {
    setTyped('');
    setConfirm({ ...o, resolve });
  }), []);
  const askReauth = useCallback<ReauthFn>(() => new Promise((resolve) => {
    setPassword('');
    setReauthError(null);
    setReauth({ resolve });
  }), []);

  const closeConfirm = (v: boolean) => {
    confirm?.resolve(v);
    setConfirm(null);
  };
  const closeReauth = (v: boolean) => {
    reauth?.resolve(v);
    setReauth(null);
  };

  const submitReauth = async () => {
    try {
      await doReauth({ password }).unwrap();
      closeReauth(true);
    } catch (e) {
      setReauthError(toApiError(e).message);
      pwRef.current?.focus();
    }
  };

  const tone = confirm?.tone ?? 'default';
  return (
    <ConfirmCtx.Provider value={askConfirm}>
      <ReauthCtx.Provider value={askReauth}>
        {children}
        <Dialog open={!!confirm} onClose={() => closeConfirm(false)} aria-labelledby="confirm-title" aria-describedby="confirm-desc" maxWidth="xs" fullWidth>
          {confirm && (
            <>
              <DialogTitle id="confirm-title" sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                {tone !== 'default' && (
                  <Box sx={{ color: tone === 'danger' ? 'error.main' : 'warning.dark', display: 'flex' }} aria-hidden>
                    {tone === 'danger' ? <AlertTriangle size={22} /> : <ShieldCheck size={22} />}
                  </Box>
                )}
                {confirm.title}
              </DialogTitle>
              <DialogContent>
                <Typography id="confirm-desc" component="div" color="text.secondary">
                  {confirm.message}
                </Typography>
                {confirm.typeToConfirm && (
                  <TextField
                    sx={{ mt: 2 }}
                    size="small"
                    autoFocus
                    label={`Type "${confirm.typeToConfirm}" to confirm`}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                  />
                )}
              </DialogContent>
              <DialogActions sx={{ px: 3, pb: 2.5 }}>
                <Button onClick={() => closeConfirm(false)} autoFocus={!confirm.typeToConfirm}>
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  color={tone === 'danger' ? 'error' : tone === 'security' ? 'warning' : 'primary'}
                  disabled={!!confirm.typeToConfirm && typed !== confirm.typeToConfirm}
                  onClick={() => closeConfirm(true)}
                >
                  {confirm.confirmLabel ?? 'Confirm'}
                </Button>
              </DialogActions>
            </>
          )}
        </Dialog>

        <Dialog open={!!reauth} onClose={() => closeReauth(false)} aria-labelledby="reauth-title" maxWidth="xs" fullWidth>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitReauth();
            }}
          >
            <DialogTitle id="reauth-title">Confirm it's you</DialogTitle>
            <DialogContent>
              <Typography color="text.secondary" sx={{ mb: 2 }}>
                This action is security-sensitive. Enter your password to continue. You won't be asked again for a few minutes.
              </Typography>
              <TextField
                inputRef={pwRef}
                type="password"
                label="Password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={!!reauthError}
                helperText={reauthError ?? ' '}
              />
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
              <Button onClick={() => closeReauth(false)}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={!password || isLoading}>
                Continue
              </Button>
            </DialogActions>
          </form>
        </Dialog>
      </ReauthCtx.Provider>
    </ConfirmCtx.Provider>
  );
}

// ─── Toasts & live region ─────────────────────────────────────────────────

export function Toaster() {
  const toasts = useAppSelector((s) => s.feedback.toasts);
  const dispatch = useAppDispatch();
  return (
    <Snackbar open={toasts.length > 0} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} sx={{ bottom: { xs: 88, md: 24 } }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end' }}>
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: tokens.motion.base }}>
              <AutoDismiss id={t.id} ms={t.severity === 'error' ? 9000 : 5000} />
              <Alert
                severity={t.severity}
                variant="filled"
                sx={{ minWidth: 280, maxWidth: 420, boxShadow: tokens.shadow.raised, alignItems: 'center' }}
                action={
                  <>
                    {t.action && (
                      <Button component={RouterLink} to={t.action.href} color="inherit" size="small" onClick={() => dispatch(dismissToast(t.id))}>
                        {t.action.label}
                      </Button>
                    )}
                    <Button color="inherit" size="small" aria-label="Dismiss notification" onClick={() => dispatch(dismissToast(t.id))} sx={{ minWidth: 0, px: 1 }}>
                      <X size={16} />
                    </Button>
                  </>
                }
              >
                {t.message}
              </Alert>
            </motion.div>
          ))}
        </AnimatePresence>
      </Box>
    </Snackbar>
  );
}

function AutoDismiss({ id, ms }: { id: string; ms: number }) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    const t = window.setTimeout(() => dispatch(dismissToast(id)), ms);
    return () => window.clearTimeout(t);
  }, [id, ms, dispatch]);
  return null;
}

/** Polite live region so screen readers hear command results. */
export function LiveAnnouncer() {
  const message = useAppSelector((s) => s.feedback.announcement);
  return (
    <Box role="status" aria-live="polite" aria-atomic="true" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
      {message}
    </Box>
  );
}
