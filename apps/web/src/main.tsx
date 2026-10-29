import '@fontsource-variable/dm-sans';
import './theme/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { MotionPreference } from './app/MotionPreference';
import { store } from './app/store';
import { DialogProvider, LiveAnnouncer, Toaster } from './components/common/Dialogs';
import { theme } from './theme/theme';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <MotionPreference>
          <BrowserRouter basename={import.meta.env.BASE_URL}>
            <DialogProvider>
              <App />
              <Toaster />
              <LiveAnnouncer />
            </DialogProvider>
          </BrowserRouter>
        </MotionPreference>
      </ThemeProvider>
    </Provider>
  </StrictMode>,
);
