import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { DEFAULT_ROOM_SUGGESTIONS, ROOM_ICONS, type RoomDto } from '@smartnest/shared';
import { toApiError, useCreateRoomMutation, useUpdateRoomMutation } from '../../api/api';
import { useHome } from '../../app/hooks';
import { pushToast, useAppDispatch } from '../../app/store';
import { AppIcon } from '../../components/common/AppIcon';

const schema = z.object({
  name: z.string().trim().min(1, 'Name the room').max(60),
  icon: z.string().min(1),
  coverImageUrl: z.union([z.literal(''), z.string().url('Enter a full image URL (https://…)').max(500)]),
});
type Form = z.infer<typeof schema>;

export function RoomDialog({ open, onClose, room, existingNames = [] }: { open: boolean; onClose: (created?: RoomDto) => void; room?: RoomDto | null; existingNames?: string[] }) {
  const { homeId } = useHome();
  const dispatch = useAppDispatch();
  const [create, c] = useCreateRoomMutation();
  const [update, u] = useUpdateRoomMutation();
  const { control, register, handleSubmit, reset, setValue, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { name: '', icon: 'home', coverImageUrl: '' } });

  useEffect(() => {
    if (open) reset({ name: room?.name ?? '', icon: room?.icon ?? 'home', coverImageUrl: room?.coverImageUrl ?? '' });
  }, [open, room, reset]);

  const error = c.error ?? u.error;
  const suggestions = DEFAULT_ROOM_SUGGESTIONS.filter((s) => !existingNames.some((n) => n.toLowerCase() === s.name.toLowerCase()));

  const submit = handleSubmit(async (v) => {
    const body = { name: v.name, icon: v.icon, coverImageUrl: v.coverImageUrl || null };
    try {
      if (room) {
        await update({ homeId, roomId: room.id, ...body }).unwrap();
        dispatch(pushToast({ message: 'Room updated', severity: 'success' }));
        onClose();
      } else {
        const r = await create({ homeId, ...body }).unwrap();
        dispatch(pushToast({ message: `${r.room.name} added`, severity: 'success' }));
        onClose(r.room);
      }
    } catch {
      /* shown inline */
    }
  });

  return (
    <Dialog open={open} onClose={() => onClose()} maxWidth="sm" fullWidth aria-labelledby="room-dialog-title">
      <form onSubmit={submit} noValidate>
        <DialogTitle id="room-dialog-title">{room ? 'Edit room' : 'Add a room'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{toApiError(error).message}</Alert>}
            {!room && suggestions.length > 0 && (
              <Box>
                <Typography variant="overline" color="text.secondary">
                  Suggestions
                </Typography>
                <Stack direction="row" flexWrap="wrap" useFlexGap gap={1} sx={{ mt: 0.5 }}>
                  {suggestions.map((s) => (
                    <Chip
                      key={s.name}
                      icon={<AppIcon name={s.icon} size={15} />}
                      label={s.name}
                      onClick={() => {
                        setValue('name', s.name, { shouldValidate: true });
                        setValue('icon', s.icon);
                      }}
                      variant="outlined"
                    />
                  ))}
                </Stack>
              </Box>
            )}
            <TextField label="Room name" autoFocus {...register('name')} error={!!formState.errors.name} helperText={formState.errors.name?.message} />
            <Box>
              <Typography variant="overline" color="text.secondary" id="icon-label">
                Icon
              </Typography>
              <Controller
                control={control}
                name="icon"
                render={({ field }) => (
                  <ToggleButtonGroup exclusive value={field.value} onChange={(_, v) => v && field.onChange(v)} aria-labelledby="icon-label" sx={{ flexWrap: 'wrap', gap: 0.75, mt: 0.5, '& .MuiToggleButton-root': { borderRadius: '12px !important', border: '1px solid #E6E4DC !important', width: 48, height: 48 } }}>
                    {ROOM_ICONS.map((i) => (
                      <ToggleButton key={i} value={i} aria-label={i.replace('-', ' ')}>
                        <AppIcon name={i} size={20} />
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                )}
              />
            </Box>
            <TextField label="Cover image URL (optional)" placeholder="https://…" {...register('coverImageUrl')} error={!!formState.errors.coverImageUrl} helperText={formState.errors.coverImageUrl?.message ?? 'Shown on the room card. Leave empty for none.'} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => onClose()}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={c.isLoading || u.isLoading}>
            {room ? 'Save' : 'Add room'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
