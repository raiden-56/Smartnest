import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { store } from '../app/store';
import { DialogProvider } from '../components/common/Dialogs';
import { theme } from '../theme/theme';

export function renderWithProviders(ui: ReactElement) {
  return render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <MemoryRouter>
          <DialogProvider>{ui}</DialogProvider>
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );
}
