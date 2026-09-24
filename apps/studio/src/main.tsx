import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mmbix/design-system';
// Fonts are loaded here (not inside the DS css) so woff2 files ship as separate
// cacheable assets and only download when the browser actually renders them.
import '@fontsource-variable/inter';
import '@fontsource/geist-mono';
import '@fontsource-variable/noto-sans-myanmar';
import '@mmbix/design-system/styles.css';
import './studio.css';
import App from './App';
import { createStudioQueryClient } from './lib/query-client';

// One client for the app's lifetime — HMR must not mint a second cache.
const queryClient = createStudioQueryClient();

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<ThemeProvider defaultTheme="system" storageKey="mmbix-studio-theme">
				<App />
			</ThemeProvider>
		</QueryClientProvider>
	</StrictMode>,
);
